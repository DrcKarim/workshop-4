import bodyParser from "body-parser";
import express from "express";
import { BASE_ONION_ROUTER_PORT, REGISTRY_PORT } from "../config";
import { generateKeyPairSync, privateDecrypt, createDecipheriv } from "crypto";
import http from "http";

let lastReceivedEncryptedMessage: string | null = null;
let lastReceivedDecryptedMessage: string | null = null;
let lastMessageDestination: number | null = null;

export async function simpleOnionRouter(nodeId: number) {
  const onionRouter = express();
  onionRouter.use(express.json());
  onionRouter.use(bodyParser.json());

  // Generate RSA Key Pair
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });

  // Register the node with the registry
  const postData = JSON.stringify({
    nodeId,
    pubKey: publicKey.export({ type: 'pkcs1', format: 'pem' }).toString()
  });

  const options = {
    hostname: 'localhost',
    port: REGISTRY_PORT,
    path: '/registerNode',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData)
    }
  };

  const req = http.request(options, (res) => {
    if (res.statusCode === 201) {
      console.log(`Node ${nodeId} registered successfully.`);
    } else {
      console.error(`Failed to register node ${nodeId}: Status Code ${res.statusCode}`);
    }
  });

  req.on('error', (error) => {
    console.error(`Error registering node ${nodeId}:`, error.message);
  });

  req.write(postData);
  req.end();

  // Status route
  onionRouter.get("/status", (req, res) => {
    res.send("live");
  });

  // GET private key for testing purposes
  onionRouter.get("/getPrivateKey", (req, res) => {
    res.json({ result: privateKey.export({ type: 'pkcs1', format: 'pem' }).toString() });
  });

  // GET routes for debugging message flow
  onionRouter.get("/getLastReceivedEncryptedMessage", (req, res) => {
    res.json({ result: lastReceivedEncryptedMessage });
  });

  onionRouter.get("/getLastReceivedDecryptedMessage", (req, res) => {
    res.json({ result: lastReceivedDecryptedMessage });
  });

  onionRouter.get("/getLastMessageDestination", (req, res) => {
    res.json({ result: lastMessageDestination });
  });

  // POST route: /message - Receive, decrypt, and forward the message
  onionRouter.post("/message", (req, res) => {
    const { message } = req.body;
    lastReceivedEncryptedMessage = message;

    try {
      // Step 1: Extract the encrypted symmetric key and encrypted message
      const encryptedSymmetricKey = Buffer.from(message.slice(0, 344), "base64"); // 2048-bit RSA key in base64
      const encryptedLayer = message.slice(344);

      // Step 2: Decrypt the symmetric key with the node's private key
      const decryptedSymmetricKey = privateDecrypt(
          privateKey,
          encryptedSymmetricKey
      );

      // Step 3: Decrypt the message layer using the symmetric key
      const iv = Buffer.alloc(16, 0); // Initialization vector
      const decipher = createDecipheriv("aes-256-cbc", decryptedSymmetricKey, iv);
      let decryptedMessage = decipher.update(encryptedLayer, "base64", "utf8");
      decryptedMessage += decipher.final("utf8");

      // Step 4: Extract the next destination (first 10 characters)
      const nextDestination = decryptedMessage.slice(0, 10);
      const nextMessage = decryptedMessage.slice(10);

      // Convert next destination to port
      const nextPort = parseInt(nextDestination, 10);
      lastReceivedDecryptedMessage = nextMessage;
      lastMessageDestination = nextPort;

      // Step 5: Forward the message to the next node or user
      const forwardOptions = {
        hostname: "localhost",
        port: nextPort,
        path: "/message",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      };

      const forwardReq = http.request(forwardOptions, (forwardRes) => {
        forwardRes.on("data", () => {});
        forwardRes.on("end", () => {
          res.status(200).send({ message: "Message forwarded successfully" });
        });
      });

      forwardReq.on("error", (error) => {
        res.status(500).send({ error: error.message });
      });

      forwardReq.write(JSON.stringify({ message: nextMessage }));
      forwardReq.end();
    } catch (error) {
      res.status(500).send({ error: "Decryption or forwarding failed" });
    }
  });

  const server = onionRouter.listen(BASE_ONION_ROUTER_PORT + nodeId, () => {
    console.log(
        `Onion router ${nodeId} is listening on port ${
            BASE_ONION_ROUTER_PORT + nodeId
        }`
    );
  });

  return server;
}
