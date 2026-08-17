import { createHmac } from "node:crypto";
import { env } from "./config/env.js";

async function main() {
  const payload = {
    object: "instagram",
    entry: [
      {
        id: "26924232307252885", // rakessh57582's Instagram User ID
        time: Math.floor(Date.now() / 1000),
        messaging: [
          {
            sender: { id: "17841408670789062" }, // rama_longhaochen's ID
            recipient: { id: "26924232307252885" },
            timestamp: Date.now(),
            message: {
              mid: `mid_test_${Date.now()}`,
              text: "TEST"
            }
          }
        ]
      }
    ]
  };

  const rawBody = JSON.stringify(payload);
  const secret = env.META_APP_SECRET || "93f1d9f0d26684e4cd0edc1f417690ef";
  const signature = "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex");

  console.log("Sending simulated Meta Webhook POST...");
  const response = await fetch("http://localhost:5000/api/webhooks/instagram", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-hub-signature-256": signature
    },
    body: rawBody
  });

  const text = await response.text();
  console.log("Response status:", response.status);
  console.log("Response body:", text);
}

main().catch(console.error);
