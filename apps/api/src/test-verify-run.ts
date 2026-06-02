import { prisma } from "./db/prisma.js";
import { capturePaypalOrder } from "./services/paypal.service.js";

async function main() {
  const txRef = "wta_pp_pro_1780392994740_kkbuu4p9";
  const transactionId = "6NS66495D76615914";
  const userId = "cmpwg0qk10004ee5kpp3dx87p";
  const dbPlan = "STARTER";

  try {
    const order = await prisma.paypalOrder.findUnique({
      where: { orderReference: txRef }
    });

    if (!order) {
      console.log("Order not found");
      return;
    }

    console.log("Found Order:", JSON.stringify(order, null, 2));

    const paypalOrderId = transactionId || order.paypalOrderId;
    console.log("Attempting capture for PayPal Order ID:", paypalOrderId);

    const success = await capturePaypalOrder(paypalOrderId!);
    console.log("Capture result:", success);

    if (success) {
      const updatedUser = await prisma.user.update({
        where: { id: userId },
        data: { plan: dbPlan }
      });
      console.log("User updated successfully:", updatedUser.plan);

      const updatedOrder = await prisma.paypalOrder.update({
        where: { id: order.id },
        data: { status: "SUCCESS" }
      });
      console.log("Order updated to SUCCESS:", updatedOrder.status);
    } else {
      console.log("Capture failed. What if we check why?");
    }
  } catch (error) {
    console.error("Verification execution error:", error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
