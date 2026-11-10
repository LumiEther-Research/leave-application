package app.lumiether;

import app.lumiether.auth.Auth;
import app.lumiether.auth.Sessions;
import app.lumiether.db.Db;
import app.lumiether.db.Store;
import app.lumiether.web.Api;
import io.helidon.webserver.WebServer;

public final class Main {
  private Main() {}

  public static void main(String[] args) {
    Config config;
    try {
      config = Config.fromEnv(System.getenv());
    } catch (Config.Invalid e) {
      System.err.println("FATAL: " + e.getMessage());
      System.exit(1);
      return;
    }
    if (config.cookieSecret() == null || config.cookieSecret().length() < 32) {
      System.err.println("WARNING: LR_COOKIE_SECRET is not set to 32 or more characters, so nobody can sign in.");
    }
    if (config.allowedOrigins().isEmpty()) {
      System.err.println("WARNING: ALLOWED_ORIGINS is empty, so every browser POST, PUT, PATCH and DELETE (which carry an Origin) will be refused.");
    }
    Db db = new Db(config.databaseUrl());
    Store store = new Store(db);
    // Read at each sign-in, as the Node app read process.env, so the bootstrap closes the moment an admin exists.
    Auth auth = new Auth(store, () -> new Auth.Bootstrap(config.adminEmail(), config.adminPasswordHash()));
    Sessions sessions = new Sessions(store, auth, config.cookieSecret());
    Api api = new Api(store, auth, sessions, new Api.Settings(config.cookieSecure(), config.allowedOrigins()), app.lumiether.domain.Dates::today,
        new app.lumiether.payslip.PdfClient(config.pdfServiceUrl()), config.cronSecret());

    WebServer server = WebServer.builder().port(config.port()).routing(api::register).build().start();
    if (!server.isRunning()) {
      System.err.println("The server did not start (is port " + config.port() + " already in use?).");
      System.exit(1);
    }
    System.out.println("LumiEther backend listening on http://localhost:" + server.port());
  }
}
