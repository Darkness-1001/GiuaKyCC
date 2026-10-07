const dns = require("node:dns");
const { MongoClient } = require("mongodb");

// Cho phép dùng DNS riêng nếu mạng hiện tại chặn truy vấn SRV của Node.js.
if (process.env.DNS_SERVERS) {
  const dnsServers = process.env.DNS_SERVERS
    .split(",")
    .map((server) => server.trim())
    .filter(Boolean);

  if (dnsServers.length > 0) {
    dns.setServers(dnsServers);
  }
}

if (!process.env.MONGODB_READ_URI) {
  throw new Error("Thiếu MONGODB_READ_URI");
}

if (!process.env.MONGODB_WRITE_URI) {
  throw new Error("Thiếu MONGODB_WRITE_URI");
}

const readClient = new MongoClient(process.env.MONGODB_READ_URI);
const writeClient = new MongoClient(process.env.MONGODB_WRITE_URI);

// Hai kết nối được khởi tạo độc lập và song song.
const readClientPromise = readClient.connect();
const writeClientPromise = writeClient.connect();

async function getReadDb() {
  const client = await readClientPromise;
  return client.db(process.env.DB_NAME);
}

async function getWriteDb() {
  const client = await writeClientPromise;
  return client.db(process.env.DB_NAME);
}

module.exports = {
  readClientPromise,
  writeClientPromise,
  getReadDb,
  getWriteDb,
};
