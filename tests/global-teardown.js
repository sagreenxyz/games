/**
 * Global test teardown: shuts down the local PeerJS signalling server.
 */
export default async function globalTeardown() {
  const server = globalThis.__testPeerHttpServer;
  if (server) {
    await new Promise((resolve) => server.close(resolve));
    console.log('\n[teardown] Local PeerJS server closed');
  }
}
