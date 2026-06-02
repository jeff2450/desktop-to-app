import { prisma } from "./db/prisma.js";

async function main() {
  try {
    const userId = "cmpwg0qk10004ee5kpp3dx87p";
    const user = await prisma.user.findUnique({
      where: { id: userId }
    });
    console.log("Specific User plan:");
    console.log(JSON.stringify(user, null, 2));

    const successOrders = await prisma.paypalOrder.findMany({
      where: { status: "SUCCESS" }
    });
    console.log("Success PayPal Orders count:", successOrders.length);
    console.log("Success PayPal Orders:", JSON.stringify(successOrders, null, 2));

    const pendingOrders = await prisma.paypalOrder.findMany({
      where: { status: "PENDING" }
    });
    console.log("Pending PayPal Orders count:", pendingOrders.length);
  } catch (err) {
    console.error("Error querying db:", err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
