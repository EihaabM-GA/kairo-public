import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { syncConnection } from "../sync.server";

export const action = async ({ request }) => {
  const { topic, shop, payload } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook from ${shop}`);

  // Find all active connections where this shop is the PARENT
  const connections = await prisma.storeConnection.findMany({
    where: {
      parentShop: shop,
      status: "active",
      syncSettings: { autoSync: true },
    },
    include: { syncSettings: true },
  });

  if (connections.length === 0) return new Response(null, { status: 200 });

  const productId = payload?.admin_graphql_api_id;
  if (!productId) return new Response(null, { status: 200 });

  // Fire and forget — don't block the webhook response
  Promise.all(
    connections.map((conn) => syncConnection(conn.id, [productId]).catch(console.error))
  );

  return new Response(null, { status: 200 });
};