export const scenarios = [
  {
    name: "read-user",
    method: "GET",
    path: "/api/users/42",
  },
  {
    name: "search-list",
    method: "GET",
    path: "/api/search?q=nova&limit=20",
  },
  {
    name: "create-order",
    method: "POST",
    path: "/api/orders/",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      customerId: "cust-1001",
      items: [
        { sku: "sku-1", quantity: 2 },
        { sku: "sku-2", quantity: 1 },
      ],
    }),
  },
];
