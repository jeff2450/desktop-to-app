import { env } from "./config/env.js";
import { getPaypalAccessToken } from "./services/paypal.service.js";

async function main() {
  const token = await getPaypalAccessToken();
  const orderId = "6NS66495D76615914"; // Last order ID in the list
  const baseUrl = env.PAYPAL_BASE_URL || "https://api-m.sandbox.paypal.com";

  try {
    console.log(`Querying order status for ${orderId}...`);
    const res = await fetch(`${baseUrl}/v2/checkout/orders/${orderId}`, {
      method: "GET",
      headers: {
        Authorization: token,
        "Content-Type": "application/json",
      }
    });

    const json = await res.json() as any;
    console.log("HTTP Status:", res.status);
    console.log("Order details:", JSON.stringify(json, null, 2));

    if (json.status === "APPROVED") {
      console.log("Order is APPROVED! Attempting to capture...");
      const captureRes = await fetch(`${baseUrl}/v2/checkout/orders/${orderId}/capture`, {
        method: "POST",
        headers: {
          Authorization: token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({})
      });
      const captureJson = await captureRes.json() as any;
      console.log("Capture HTTP Status:", captureRes.status);
      console.log("Capture Response:", JSON.stringify(captureJson, null, 2));
    }
  } catch (err) {
    console.error("Error:", err);
  }
}

main();
