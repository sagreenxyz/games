/**
 * Global test setup: starts a local PeerJS signalling server so E2E tests
 * work without depending on the external PeerJS cloud.
 *
 * `PeerServer(options, callback)` – callback receives the underlying http.Server
 * once it is bound and listening.
 */
import { PeerServer } from 'peer';

const PEER_PORT = 9001;

export default async function globalSetup() {
  await new Promise((resolve, reject) => {
    // PeerServer returns the Express middleware; the underlying http.Server is
    // passed to the optional callback once it starts listening.
    try {
      PeerServer({ port: PEER_PORT, path: '/peerjs' }, (httpServer) => {
        console.log(`\n[setup] Local PeerJS server listening on port ${PEER_PORT}`);
        globalThis.__testPeerHttpServer = httpServer;
        resolve();
      });
    } catch (err) {
      reject(err);
    }
  });
}
