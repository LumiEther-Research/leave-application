package app.lumiether.auth;

import static org.junit.jupiter.api.Assertions.*;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Base64;
import java.util.List;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;

/** Port of the "password hashing" group of auth.test.ts, plus proof against hashes made by Node. */
class PasswordTest {
  @Test
  void theRightPasswordVerifiesAndAWrongOneDoesnt() {
    String hash = Password.hash("correct horse battery");
    assertTrue(Password.verify("correct horse battery", hash));
    assertFalse(Password.verify("correct horse batter", hash));
  }

  @Test
  void theSamePasswordHashesDifferentlyEachTime() {
    assertNotEquals(Password.hash("same"), Password.hash("same"));
  }

  @Test
  void thePlainPasswordIsNotInTheStoredHash() {
    assertFalse(Password.hash("hunter2hunter2").contains("hunter2"));
  }

  @Test
  void hashesContainNoDollarSoEnvFilesDontExpandThem() {
    assertFalse(Password.hash("x").contains("$"));
  }

  @Test
  void garbageEmptyAndMissingHashesNeverVerify() {
    for (String bad : new String[] {"", "nope", "scrypt:a", "scrypt:a:b", "bcrypt:a:b", "scrypt:a:b:c", null}) {
      assertFalse(Password.verify("anything", bad), String.valueOf(bad));
    }
  }

  @Test
  void theDummyHashUsedForUnknownEmailsNeverVerifies() {
    assertFalse(Password.verify("", Password.DUMMY_HASH));
    assertFalse(Password.verify("password", Password.DUMMY_HASH));
    assertTrue(Password.isPasswordHash(Password.DUMMY_HASH));
  }

  @Test
  void isPasswordHashAcceptsOurHashesAndRejectsTheRest() {
    assertTrue(Password.isPasswordHash(Password.hash("x")));
    assertFalse(Password.isPasswordHash(Password.hash("x").replaceFirst("^scrypt:", "")));
    assertFalse(Password.isPasswordHash(null));
    assertFalse(Password.isPasswordHash("scrypt:a:b"));
  }

  /** node-hashes.tsv was made by scripts/hash-password.mjs. Java has to accept every one of them. */
  @Test
  void hashesMadeByTheNodeScriptVerifyHere() throws IOException {
    List<String> lines = Files.readAllLines(Path.of("src/test/resources/node-hashes.tsv"));
    assertEquals(8, lines.size());
    for (String line : lines) {
      String[] cols = line.split("\t");
      String password = new String(Base64.getDecoder().decode(cols[0]), StandardCharsets.UTF_8);
      assertTrue(Password.isPasswordHash(cols[1]), password);
      assertTrue(Password.verify(password, cols[1]), "node hash for: " + password);
      assertFalse(Password.verify(password + "!", cols[1]), "wrong password for: " + password);
    }
  }

  /** The password is NFKC-normalised first, so a ligature and a circled digit equal their plain forms. */
  @Test
  void nfkcNormalisationMatchesNode() throws IOException {
    String nodeHash = Files.readAllLines(Path.of("src/test/resources/node-hashes.tsv")).stream()
        .filter(l -> new String(Base64.getDecoder().decode(l.split("\t")[0]), StandardCharsets.UTF_8).startsWith("ﬁnal"))
        .findFirst().orElseThrow().split("\t")[1];
    assertTrue(Password.verify("final password 1", nodeHash));
  }

  @Test
  void ourHashesVerifyInNodeToo() throws Exception {
    Assumptions.assumeTrue(nodeAvailable(), "node is not installed");
    String hash = Password.hash("java made this ünï");
    // Node's own verification code path: re-derive with crypto.scrypt and compare.
    String js = "const c=require('node:crypto');const [,s,k]=process.argv[1].split(':');"
        + "c.scrypt(process.argv[2].normalize('NFKC'),Buffer.from(s,'base64url'),64,(e,d)=>{"
        + "process.stdout.write(d.equals(Buffer.from(k,'base64url'))?'match':'differ')})";
    Process p = new ProcessBuilder("node", "-e", js, hash, "java made this ünï").redirectErrorStream(true).start();
    String out = new String(p.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
    assertTrue(p.waitFor(30, TimeUnit.SECONDS));
    assertEquals("match", out);
  }

  /** scripts/hash-password.mjs, run live. */
  @Test
  void theScriptMakesAHashTheAppAccepts() throws Exception {
    Assumptions.assumeTrue(nodeAvailable(), "node is not installed");
    Process p = new ProcessBuilder("node", "scripts/hash-password.mjs", "from the script")
        .directory(Path.of("..").toFile()).redirectErrorStream(true).start();
    String out = new String(p.getInputStream().readAllBytes(), StandardCharsets.UTF_8).strip();
    assertTrue(p.waitFor(30, TimeUnit.SECONDS));
    assertTrue(Password.verify("from the script", out));
    assertFalse(Password.verify("something else", out));
  }

  /** A burst of sign-ins must not run more scrypts at once than the cap, or memory runs out (16 MiB each). */
  @Test
  void aBurstNeverRunsMoreScryptsAtOnceThanTheCap() throws Exception {
    String hash = Password.hash("burst");
    var pool = java.util.concurrent.Executors.newVirtualThreadPerTaskExecutor();
    var futures = new java.util.ArrayList<java.util.concurrent.Future<Boolean>>();
    for (int i = 0; i < 64; i++) futures.add(pool.submit(() -> Password.verify("burst", hash)));
    for (var f : futures) assertTrue(f.get());
    pool.close();
    assertTrue(Password.peakConcurrent() <= Password.SLOTS, "peak " + Password.peakConcurrent() + " > " + Password.SLOTS);
    assertTrue(Password.peakConcurrent() >= 1);
  }

  private static boolean nodeAvailable() {
    try {
      Process p = new ProcessBuilder("node", "--version").redirectErrorStream(true).start();
      return p.waitFor(10, TimeUnit.SECONDS) && p.exitValue() == 0;
    } catch (Exception e) {
      return false;
    }
  }
}
