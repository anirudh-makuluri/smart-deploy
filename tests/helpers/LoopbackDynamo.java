import java.lang.reflect.Field;
import org.eclipse.jetty.server.Connector;
import org.eclipse.jetty.server.Server;
import org.eclipse.jetty.server.ServerConnector;
import software.amazon.dynamodb.services.local.main.ServerRunner;

// Pinned test emulator only. Its CLI has no bind-address flag.
public class LoopbackDynamo {
    public static void main(String[] args) throws Exception {
        var proxy = ServerRunner.createServerFromCommandLineArgs(new String[] {
            "-inMemory", "-sharedDb", "-disableTelemetry", "-port", args[0]
        });
        Field field = proxy.getClass().getDeclaredField("server");
        field.setAccessible(true);
        Server server = (Server) field.get(proxy);
        if (server.getConnectors().length != 1) throw new IllegalStateException("Unexpected emulator connector");
        for (Connector connector : server.getConnectors()) {
            if (!(connector instanceof ServerConnector)) throw new IllegalStateException("Unexpected connector type");
            ((ServerConnector) connector).setHost("127.0.0.1");
        }
        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            try { proxy.stop(); } catch (Exception ignored) { }
        }));
        proxy.start();
        System.out.println("SMARTDEPLOY_LOOPBACK_DYNAMO_READY");
        proxy.join();
    }
}
