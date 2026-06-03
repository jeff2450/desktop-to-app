import { startOfMonth } from "date-fns";
import { prisma } from "../db/prisma.js";

export async function getUsageStats(userId: string): Promise<number> {
  return prisma.job.count({
    where: {
      userId,
      createdAt: { gte: startOfMonth(new Date()) },
      status: { not: "CANCELLED" }
    }
  });
}
