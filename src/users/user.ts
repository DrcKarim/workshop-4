import bodyParser from "body-parser";
import express from "express";
import { BASE_USER_PORT } from "../config";
import { createCipheriv, createDecipheriv, generateKeySync, publicEncrypt, randomBytes  } from "crypto";
import http from "http";


export type SendMessageBody = {
  message: string;
  destinationUserId: number;
};

let lastReceivedMessage: string | null = null;
let lastSentMessage: string | null = null;

export async function user(userId: number) {
  const _user = express();
  _user.use(express.json());
  _user.use(bodyParser.json());

  // TODO implement the status route
  // _user.get("/status", (req, res) => {});
  // Implement the status route
  _user.get("/status", (req, res) => {
    res.send("live");
  });


  // GET route: /getLastReceivedMessage
  _user.get("/getLastReceivedMessage", (req, res) => {
    res.json({ result: lastReceivedMessage });
  });

  // GET route: /getLastSentMessage
  _user.get("/getLastSentMessage", (req, res) => {
    res.json({ result: lastSentMessage });
  });


  // POST route: /sendMessage - Encrypt and forward the message
  _user.post("/sendMessage", async (req, res) => {
    const { message, destinationUserId } = req.body;
    lastSentMessage = message;

    // Step 1: Retrieve the list of registered nodes
    const registryOptions = {
      hostname: "localhost",
      port: 8080,
      path: "/getNodeRegistry",
      method: "GET",
    };

    const registryReq = http.request(registryOptions, (registryRes) => {
      let data = "";
      registryRes.on("data", (chunk) => {
        data += chunk;
      });

      registryRes.on("end", () => {
        const { nodes } = JSON.parse(data);

        // Step 2: Select 3 random, distinct nodes for the circuit
        const selectedNodes = nodes.sort(() => 0.5 - Math.random()).slice(0, 3);

        // Step 3: Create layered encryption
        let encryptedMessage = message;

        selectedNodes.reverse().forEach((node: { nodeId: number; pubKey: string }) => {
          const symmetricKey: Buffer = randomBytes(32); // 256-bit key for AES-256
          const iv: Buffer = Buffer.alloc(16, 0); // Initialization vector

          // Encrypt the message with symmetric key
          const cipher = createCipheriv("aes-256-cbc", symmetricKey, iv);
          let encryptedLayer = cipher.update(encryptedMessage, "utf8", "base64");
          encryptedLayer += cipher.final("base64");

          // Encrypt symmetric key with the node's public RSA key
          const encryptedSymmetricKey = publicEncrypt(
              node.pubKey,
              symmetricKey
          ).toString("base64");

          // Concatenate the encrypted symmetric key with the encrypted message
          encryptedMessage = encryptedSymmetricKey + encryptedLayer;
        });

        // Step 4: Send the fully encrypted message to the first node
        const firstNode = selectedNodes[0];
        const nodeOptions = {
          hostname: "localhost",
          port: 4000 + firstNode.nodeId,
          path: "/message",
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
        };

        const nodeReq = http.request(nodeOptions, (nodeRes) => {
          nodeRes.on("data", () => {});
          nodeRes.on("end", () => {
            res.status(200).send({ message: "Message sent successfully" });
          });
        });

        nodeReq.on("error", (error) => {
          res.status(500).send({ error: error.message });
        });

        nodeReq.write(JSON.stringify({ message: encryptedMessage }));
        nodeReq.end();
      });
    });

    registryReq.on("error", (error) => {
      res.status(500).send({ error: error.message });
    });

    registryReq.end();
  });

  // POST route: /message - Receive and decrypt messages
  _user.post("/message", (req, res) => {
    lastReceivedMessage = req.body.message;
    res.status(200).send({ message: "Message received" });
  });

  const server = _user.listen(BASE_USER_PORT + userId, () => {
    console.log(
      `User ${userId} is listening on port ${BASE_USER_PORT + userId}`
    );
  });

  return server;
}
