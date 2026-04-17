import "dotenv/config";
import mysql from "mysql2/promise";

const conn = await mysql.createConnection(process.env.DATABASE_URL);
try {
  console.log("--- paid orders by orders.buildingSlug ---");
  const [rows1] = await conn.execute(
    `SELECT
       buildingSlug,
       COUNT(*) AS paidOrders,
       SUM(CASE WHEN bldgUserId IS NULL THEN 1 ELSE 0 END) AS paidWithoutBldgUserId,
       COUNT(DISTINCT bldgUserId) AS distinctBldgUserIds
     FROM orders
     WHERE paid = 1
     GROUP BY buildingSlug`
  );
  console.log(rows1);

  console.log("\n--- paid users joined to bldg_users.buildingSlug ---");
  const [rows2] = await conn.execute(
    `SELECT bu.buildingSlug AS userBuildingSlug,
            COUNT(DISTINCT o.bldgUserId) AS paidUsers
     FROM orders o
     INNER JOIN bldg_users bu ON o.bldgUserId = bu.id
     WHERE o.paid = 1
     GROUP BY bu.buildingSlug`
  );
  console.log(rows2);

  console.log("\n--- the 10 paid bldgUserIds and their bldg_users rows ---");
  const [rows3] = await conn.execute(
    `SELECT DISTINCT o.bldgUserId, bu.id AS userId, bu.firstName, bu.lastName, bu.buildingSlug, bu.unit
     FROM orders o
     LEFT JOIN bldg_users bu ON o.bldgUserId = bu.id
     WHERE o.paid = 1 AND o.bldgUserId IS NOT NULL`
  );
  console.log(rows3);
} finally {
  await conn.end();
}
