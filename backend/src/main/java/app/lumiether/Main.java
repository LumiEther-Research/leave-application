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
    Config config = Config.fromEnv(System.getenv());
    Db db = new Db(config.databaseUrl());
    Store store = new Store(db);
    // Read at each sign-in, as the Node app read process.env, so the bootstrap closes the moment an admin exists.
    Auth auth = new Auth(store, () -> new Auth.Bootstrap(config.adminEmail(), config.adminPasswordHash()));
    Sessions sessions = new Sessions(store, auth, config.sessionSecret());

    WebServer server = WebServer.builder().port(config.port()).routing(new Api(store, auth, sessions, config.corsOrigin())::register).build().start();
    if (!server.isRunning()) {
      System.err.println("The server did not start (is port " + config.port() + " already in use?).");
      System.exit(1);
    }
    System.out.println("LumiEther backend listening on http://localhost:" + server.port());
  }
}
