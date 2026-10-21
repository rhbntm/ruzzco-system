package com.ruzzco.barbers;

import static org.junit.Assert.assertEquals;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;

import org.junit.After;
import org.junit.Test;

/**
 * probe() over real HTTP, against a tiny server on this computer that answers like ruzzco-system.
 * (Plain sockets: unit tests compile against Android's Java, which has no built-in HTTP server.)
 */
public class ServerCheckProbeTest {
    private ServerSocket server;

    /** Answers the health route with this status, extra header line and body; other paths get 404. */
    private String serve(String statusLine, String extraHeader, String body) throws IOException {
        server = new ServerSocket(0, 50, InetAddress.getLoopbackAddress());
        Thread thread = new Thread(() -> {
            while (!server.isClosed()) {
                try (Socket socket = server.accept()) {
                    BufferedReader in = new BufferedReader(new InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8));
                    String requestLine = in.readLine();
                    String line;
                    while ((line = in.readLine()) != null && !line.isEmpty()) {
                        // skip the request headers
                    }
                    boolean health = requestLine != null && requestLine.startsWith("GET " + ServerCheck.HEALTH_PATH + " ");
                    String text = health ? body : "{\"success\":false,\"error\":\"Not found\"}";
                    byte[] bytes = text.getBytes(StandardCharsets.UTF_8);
                    String head = "HTTP/1.1 " + (health ? statusLine : "404 Not Found") + "\r\n"
                            + "Content-Type: application/json\r\n"
                            + (health && extraHeader != null ? extraHeader + "\r\n" : "")
                            + "Content-Length: " + bytes.length + "\r\n"
                            + "Connection: close\r\n\r\n";
                    OutputStream out = socket.getOutputStream();
                    out.write(head.getBytes(StandardCharsets.UTF_8));
                    out.write(bytes);
                    out.flush();
                } catch (IOException e) {
                    return; // the server was closed
                }
            }
        });
        thread.setDaemon(true);
        thread.start();
        return "http://127.0.0.1:" + server.getLocalPort();
    }

    @After
    public void stop() throws IOException {
        if (server != null) server.close();
    }

    @Test
    public void healthyRuzzcoServer() throws IOException {
        String base = serve("200 OK", null, ServerCheckTest.HEALTHY);
        assertEquals(ServerCheck.Result.RUZZCO, ServerCheck.probe(base, 2000, 2000));
    }

    @Test
    public void ruzzcoWithItsDatabaseDown() throws IOException {
        // The 503 body comes through the error stream.
        String base = serve("503 Service Unavailable", null, ServerCheckTest.DATABASE_DOWN);
        assertEquals(ServerCheck.Result.RUZZCO_DATABASE_DOWN, ServerCheck.probe(base, 2000, 2000));
    }

    @Test
    public void anotherWebServer() throws IOException {
        String base = serve("200 OK", null, "<!DOCTYPE html><html><body>Router login</body></html>");
        assertEquals(ServerCheck.Result.NOT_RUZZCO, ServerCheck.probe(base, 2000, 2000));
    }

    @Test
    public void redirectsAreNotFollowed() throws IOException {
        String base = serve("302 Found", "Location: http://example.com/", "");
        assertEquals(ServerCheck.Result.NOT_RUZZCO, ServerCheck.probe(base, 2000, 2000));
    }
}
