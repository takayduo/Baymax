const { RemoteSession } = require('../electron/remoteSession');

const rs = new RemoteSession();
const sessionId = rs.begin(); // Badsha starts a viewer session

// Simulating Ayzill's accept response arriving with PostgreSQL server time
// Since local clock is 79.5 seconds behind server clock:
const serverTimestamp = Date.now() + 79500;

const responsePacket = {
  action: 'response',
  sessionId: sessionId,
  senderId: 'ad677f5a-9cb0-4708-859c-22a0a46c3185',
  accepted: true,
  timestamp: serverTimestamp
};

console.log("Testing remoteSession.receive with serverTimestamp:");
const accepted = rs.receive(responsePacket);
console.log("Was packet accepted by remoteSession?", accepted);
if (!accepted) {
  console.log("FAILED because Math.abs(Date.now() - timestamp) was:", Math.abs(Date.now() - serverTimestamp), "which is > 30000!");
}
