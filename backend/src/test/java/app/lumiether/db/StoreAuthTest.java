package app.lumiether.db;

import static org.junit.jupiter.api.Assertions.*;

import app.lumiether.auth.Auth;
import app.lumiether.auth.ChangePassword;
import app.lumiether.auth.Password;
import app.lumiether.auth.Token;
import app.lumiether.auth.Token.Role;
import app.lumiether.domain.Types.*;
import java.util.List;
import java.util.TreeSet;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.*;

/**
 * Port of the "employees and holidays", "signing in", "changing a password" and "admins" groups of store.test.ts.
 * (The request half of "a made-up id never reaches the database" comes with the leave code in a later phase.)
 */
class StoreAuthTest {
  Db db;
  Store store;
  final AtomicReference<Auth.Bootstrap> bootstrap = new AtomicReference<>(new Auth.Bootstrap(null, null));
  Auth auth;

  @BeforeEach
  void setUp() {
    db = TestDb.reset();
    store = new Store(db);
    bootstrap.set(new Auth.Bootstrap(null, null));
    auth = new Auth(store, bootstrap::get);
  }

  Admin admin(String name) {
    return admin(name, "admin-pass-1");
  }

  Admin admin(String name, String password) {
    return store.createAdmin(name, name.toLowerCase() + "@example.com", Password.hash(password));
  }

  Employee employee(String name) {
    return store.createEmployee(Store.NewEmployee.of(name, name.toLowerCase() + "@gmail.com", "2000-01-01", Password.hash("temp-pass-1")));
  }

  static SessionUser asUser(String id, String name, String email, Role role) {
    return new SessionUser(id, name, email, role);
  }

  SessionUser adminUser(Admin a) {
    return asUser(a.id(), a.name(), a.email(), Role.admin);
  }

  // ------------------------------------------------- employees and holidays

  @Test
  void theFourNationalHolidaysAreInTheTable() {
    assertEquals(
        List.of(new Holiday("Republic Day", 1, 26), new Holiday("Labour Day", 5, 1),
            new Holiday("Independence Day", 8, 15), new Holiday("Gandhi Jayanti", 10, 2)),
        store.getHolidays());
  }

  @Test
  void anEmployeeIsSavedWithAUuidIdAndFoundByEmailInAnyCase() {
    Employee e = employee("Priya");
    assertTrue(Db.isUuid(e.id()));
    StoredEmployee found = store.findEmployeeByEmail("PRIYA@Gmail.com").orElseThrow();
    assertEquals(List.of(e.id(), "Priya", "2000-01-01", 24),
        List.of(found.employee().id(), found.employee().name(), found.employee().joiningDate(), found.employee().leaveAllowance()));
    assertEquals("employee", found.employee().category());
  }

  @Test
  void theSameEmailCantBeUsedTwiceWhateverItsCase() {
    employee("Priya");
    var e = assertThrows(DbException.class,
        () -> store.createEmployee(Store.NewEmployee.of("Again", "PRIYA@gmail.com", "2026-01-01", "x")));
    assertTrue(Db.isUniqueViolation(e));
  }

  @Test
  void anEmailCountsAsTakenIfAnAdminOrAnEmployeeHasIt() {
    employee("Priya");
    admin("Boss");
    assertTrue(store.isEmailTaken("priya@gmail.com"));
    assertTrue(store.isEmailTaken("BOSS@example.com"));
    assertFalse(store.isEmailTaken("nobody@gmail.com"));
  }

  @Test
  void aMadeUpIdNeverReachesTheDatabaseAsAUuid() {
    assertTrue(store.findAdminById("not-a-uuid").isEmpty());
    assertTrue(store.findEmployeeById("not-a-uuid").isEmpty());
    assertFalse(store.setEmployeePasswordHash("not-a-uuid", "x"));
  }

  // --------------------------------------------------------------- signing in

  @Test
  void anEmployeeSignsInWithTheirTemporaryPasswordAWrongOneOrAnUnknownEmailFails() {
    employee("Priya");
    var ok = auth.authenticate("Priya@Gmail.com", "temp-pass-1");
    assertEquals(Role.employee, ok.user().role());
    assertEquals(Auth.Failure.WRONG_PASSWORD, auth.authenticate("priya@gmail.com", "nope").failure());
    assertFalse(auth.authenticate("stranger@gmail.com", "x").ok());
  }

  @Test
  void anAdminInTheTableSignsInAsAnAdmin() {
    admin("Boss");
    assertEquals(Role.admin, auth.authenticate("boss@example.com", "admin-pass-1").user().role());
    assertEquals(Auth.Failure.WRONG_PASSWORD, auth.authenticate("boss@example.com", "nope").failure());
  }

  @Test
  void bootstrapWithNoAdminsTheEnvAdminGetsInAndIsSavedAsANormalAdmin() {
    bootstrap.set(new Auth.Bootstrap("Boss@Example.com", Password.hash("env-password-1")));
    assertEquals(0, store.countAdmins());

    var first = auth.authenticate("boss@example.com", "env-password-1");
    assertEquals(Role.admin, first.user().role());
    assertEquals(1, store.countAdmins());

    // From now on they're an ordinary admin: the environment is no longer consulted.
    bootstrap.set(new Auth.Bootstrap("Boss@Example.com", Password.hash("something-else-1")));
    assertTrue(auth.authenticate("boss@example.com", "env-password-1").ok());
    assertFalse(auth.authenticate("boss@example.com", "something-else-1").ok());
  }

  @Test
  void bootstrapIsClosedOnceAnyAdminExistsEvenForTheAdminEmailAddress() {
    admin("Other");
    bootstrap.set(new Auth.Bootstrap("boss@example.com", Password.hash("env-password-1")));
    assertEquals(Auth.Failure.BOOTSTRAP_CLOSED, auth.authenticate("boss@example.com", "env-password-1").failure());
    assertTrue(store.findAdminByEmail("boss@example.com").isEmpty());
  }

  @Test
  void bootstrapFailuresWrongPasswordMissingHashMalformedHashNoAdminEmail() {
    String hash = Password.hash("env-password-1");
    bootstrap.set(new Auth.Bootstrap("boss@example.com", hash));
    assertEquals(Auth.Failure.WRONG_PASSWORD, auth.authenticate("boss@example.com", "nope").failure());

    bootstrap.set(new Auth.Bootstrap("boss@example.com", hash.replaceFirst("^scrypt:", ""))); // prefix lost in copy/paste
    assertEquals(Auth.Failure.MALFORMED_ADMIN_HASH, auth.authenticate("boss@example.com", "env-password-1").failure());

    bootstrap.set(new Auth.Bootstrap("boss@example.com", null));
    assertEquals(Auth.Failure.MISSING_ADMIN_HASH, auth.authenticate("boss@example.com", "env-password-1").failure());

    bootstrap.set(new Auth.Bootstrap(null, null));
    assertEquals(Auth.Failure.ADMIN_NOT_CONFIGURED, auth.authenticate("boss@example.com", "x").failure());
    assertEquals(0, store.countAdmins());
  }

  @Test
  void twoFirstSignInsAtTheSameMomentBothGetInAndOnlyOneAdminIsCreated() throws Exception {
    bootstrap.set(new Auth.Bootstrap("boss@example.com", Password.hash("env-password-1")));
    ExecutorService pool = Executors.newFixedThreadPool(2);
    var a = pool.submit(() -> auth.authenticate("boss@example.com", "env-password-1"));
    var b = pool.submit(() -> auth.authenticate("boss@example.com", "env-password-1"));
    var results = List.of(a.get(), b.get());
    pool.shutdown();
    // One creates the row; the other either finds it (unique violation path) or sees the bootstrap closed.
    assertTrue(results.stream().anyMatch(Auth.Result::ok), results.toString());
    assertEquals(1, store.countAdmins());
  }

  @Test
  void anEmailIsInUseIfItsAnAdminsAnEmployeesOrTheBootstrapAdminEmail() {
    bootstrap.set(new Auth.Bootstrap("boss@example.com", null));
    employee("Priya");
    assertTrue(auth.isEmailInUse("BOSS@example.com"));
    assertTrue(auth.isEmailInUse("priya@gmail.com"));
    assertFalse(auth.isEmailInUse("new@example.com"));
  }

  // -------------------------------------------------------- changing a password

  @Test
  void anEmployeesNewPasswordWorksAndTheOldOneStops() {
    Employee e = employee("Priya");
    var change = new ChangePassword(store, auth);
    var errors = change.change(asUser(e.id(), e.name(), e.email(), Role.employee), new ChangePassword.Input("temp-pass-1", "my-own-pass-9", "my-own-pass-9"));
    assertTrue(errors.isEmpty());
    assertTrue(auth.authenticate(e.email(), "my-own-pass-9").ok());
    assertEquals(Auth.Failure.WRONG_PASSWORD, auth.authenticate(e.email(), "temp-pass-1").failure());
  }

  @Test
  void aWrongCurrentPasswordIsRefusedAndNothingChanges() {
    Employee e = employee("Priya");
    var errors = new ChangePassword(store, auth).change(asUser(e.id(), e.name(), e.email(), Role.employee), new ChangePassword.Input("not-it", "my-own-pass-9", "my-own-pass-9"));
    assertTrue(errors.containsKey("current"));
    assertTrue(auth.authenticate(e.email(), "temp-pass-1").ok());
  }

  @Test
  void anAdminChangesOnlyTheirOwnPasswordAndTheFingerprintChangesSoOldSessionsStop() {
    Admin a = admin("Boss");
    Admin other = admin("Other");
    SessionUser user = adminUser(a);
    String before = Token.passwordFingerprint(auth.credentialHashFor(user));

    var errors = new ChangePassword(store, auth).change(user, new ChangePassword.Input("admin-pass-1", "chosen-by-them-1", "chosen-by-them-1"));
    assertTrue(errors.isEmpty());
    assertTrue(auth.authenticate(a.email(), "chosen-by-them-1").ok());
    assertFalse(auth.authenticate(a.email(), "admin-pass-1").ok());
    assertNotEquals(before, Token.passwordFingerprint(auth.credentialHashFor(user)));
    assertTrue(auth.authenticate(other.email(), "admin-pass-1").ok()); // untouched
  }

  // -------------------------------------------------------------------- admins

  @Test
  void adminsAreListedWithoutTheirPasswordHashes() {
    admin("Boss");
    // The Admin record has exactly these components and no hash.
    assertEquals(new TreeSet<>(List.of("email", "id", "name")),
        new TreeSet<>(java.util.Arrays.stream(Admin.class.getRecordComponents()).map(c -> c.getName()).toList()));
    assertEquals(1, store.listAdmins().size());
  }

  @Test
  void theSameAdminEmailCantBeAddedTwiceWhateverItsCase() {
    admin("Boss");
    var e = assertThrows(DbException.class, () -> store.createAdmin("Again", "BOSS@example.com", "x"));
    assertTrue(Db.isUniqueViolation(e));
  }

  @Test
  void anAdminCanRemoveAnotherAdminWhoThenCantSignInAndHasNoAccountForASessionToFind() {
    Admin a = admin("Boss");
    Admin b = admin("Second");
    assertEquals(Store.Result.OK, auth.removeAdmin(adminUser(a), b.id()));
    assertTrue(store.findAdminById(b.id()).isEmpty());
    assertFalse(auth.authenticate(b.email(), "admin-pass-1").ok());
    assertEquals(1, store.listAdmins().size());
  }

  @Test
  void nobodyCanRemoveThemselves() {
    Admin a = admin("Boss");
    admin("Second");
    var result = auth.removeAdmin(adminUser(a), a.id());
    assertFalse(result.ok());
    assertTrue(result.error().contains("own admin account"));
    assertEquals(2, store.listAdmins().size());
  }

  @Test
  void theLastAdminCantBeRemovedByTheAppOrByTheDatabaseItself() {
    Admin a = admin("Boss");
    SessionUser stranger = asUser("00000000-0000-4000-8000-000000000000", "Gone", "gone@x.com", Role.admin);

    var viaApp = auth.removeAdmin(stranger, a.id());
    assertFalse(viaApp.ok());
    assertTrue(viaApp.error().contains("at least one admin"));

    var viaStore = store.deleteAdmin(stranger.id(), a.id()); // skips the app's own count check
    assertFalse(viaStore.ok());
    assertTrue(viaStore.error().contains("at least one admin"));

    var raw = assertThrows(DbException.class, () -> db.query("delete from admins")); // raw SQL can't empty the table either
    assertTrue(raw.getMessage().contains("last_admin"));
    assertEquals(1, store.countAdmins());
  }

  @RepeatedTest(5)
  void twoAdminsRemovingEachOtherAtTheSameMomentCantLeaveZeroAdmins() throws Exception {
    Admin a = admin("Boss");
    Admin b = admin("Second");
    ExecutorService pool = Executors.newFixedThreadPool(2);
    CountDownLatch go = new CountDownLatch(1);
    Callable<Store.Result> aRemovesB = () -> { go.await(); return auth.removeAdmin(adminUser(a), b.id()); };
    Callable<Store.Result> bRemovesA = () -> { go.await(); return auth.removeAdmin(adminUser(b), a.id()); };
    var f1 = pool.submit(aRemovesB);
    var f2 = pool.submit(bRemovesA);
    go.countDown();
    var results = List.of(f1.get(), f2.get());
    pool.shutdown();
    assertEquals(1, results.stream().filter(Store.Result::ok).count(), results.toString());
    assertEquals(1, store.countAdmins());
  }

  @Test
  void removingAnAdminThatDoesntExistSaysSoAndOtherAdminsKeepTheirAccess() {
    Admin a = admin("Boss");
    Admin other = admin("Other");
    var missing = auth.removeAdmin(adminUser(a), "00000000-0000-4000-8000-000000000001");
    assertFalse(missing.ok());
    assertTrue(missing.error().contains("no longer exists"));
    assertTrue(auth.authenticate(other.email(), "admin-pass-1").ok());
  }
}
