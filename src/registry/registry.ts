import bodyParser from "body-parser";
import express, { Request, Response } from "express";
import { REGISTRY_PORT } from "../config";

export type Node = { nodeId: number; pubKey: string };
let nodeRegistry: Node[] = [];  // In-memory registry

export type RegisterNodeBody = {
  nodeId: number;
  pubKey: string;
};

export type GetNodeRegistryBody = {
  nodes: Node[];
};

export async function launchRegistry() {
  const _registry = express();
  _registry.use(express.json());
  _registry.use(bodyParser.json());

  // TODO implement the status route
  // _registry.get("/status", (req, res) => {});
  // Implement the status route
   _registry.get("/status", (req, res) => {
    res.send("live");
   });

    // POST /registerNode - Register a node
    _registry.post("/registerNode", (req, res) => {
        const { nodeId, pubKey } = req.body;
        nodeRegistry.push({ nodeId, pubKey });
        res.status(201).send({ message: "Node registered successfully" });
    });

    // GET /getNodeRegistry - Return list of registered nodes
    _registry.get("/getNodeRegistry", (req, res) => {
        res.json({ nodes: nodeRegistry });
    });

  const server = _registry.listen(REGISTRY_PORT, () => {
    console.log(`registry is listening on port ${REGISTRY_PORT}`);
  });

  return server;
}
