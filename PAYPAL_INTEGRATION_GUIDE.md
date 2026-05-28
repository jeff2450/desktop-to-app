# PayPal Integration Guide

A reference for setting up and integrating PayPal payments in a full-stack Next.js + Express project.
Based on the working implementation in **desktop-to-app** (May 2026).

---

## 1. PayPal Developer Account Setup

### 1.1 Create a Developer Account
1. Go to [developer.paypal.com](https://developer.paypal.com)
2. Log in with your regular PayPal account (or create one)
3. Navigate to **Dashboard → Apps & Credentials**

### 1.2 Create a Sandbox App
1. Under **Sandbox**, click **Create App**
2. Give it a name (e.g. `my-project-dev`)
3. Leave **App Type** as **Merchant**
4. Click **Create App**

You will be given:
- **Client ID** → `PAYPAL_CLIENT_ID`
- **Client Secret** → `PAYPAL_CLIENT_SECRET`

> [!IMPORTANT]
> These sandbox credentials only work against `https://api-m.sandbox.paypal.com`.
> Create a **separate Live app** under the **Live** tab when going to production.

### 1.3 Create a Live App (Production)
1. Under **Live**, click **Create App**
2. Same steps as sandbox — you get a different Client ID / Secret pair
3. Use these only when `NODE_ENV=production`

---

## 2. Sandbox Test Accounts

PayPal auto-creates two sandbox accounts per app:

| Type | Usage |
|------|-------|
| **Business** | The merchant receiving money |
| **Personal** | The buyer paying money |

To find them:
1. Go to **Sandbox → Accounts**
2. Click the **Personal** account → **View/Edit** → get email + password
3. Use these credentials when the PayPal popup appears during testing

> [!TIP]
> You can create additional sandbox accounts (e.g. multiple buyer accounts) under **Sandbox → Accounts → Create Account**.

---

## 3. Environment Variables

### API Server (Express / Node)
```env
# apps/api/.env
PAYPAL_CLIENT_ID="AVZ3wuYtpa..."          # From Sandbox App
PAYPAL_CLIENT_SECRET="EEGZDfW-kf..."      # From Sandbox App
NODE_ENV="development"                     # Switches between sandbox and live URLs
```

### Web Frontend (Next.js)
```env
# apps/web/.env
NEXT_PUBLIC_PAYPAL_CLIENT_ID="AVZ3wuYtpa..."   # Same Client ID — must be public for the JS SDK
```

> [!CAUTION]
> **Never** expose `PAYPAL_CLIENT_SECRET` to the frontend. It must only live in the server-side `.env`.
> The `NEXT_PUBLIC_` prefix makes a variable visible in the browser bundle — use it only for the Client ID.

---

## 4. Architecture Overview

```
Browser
  │
  ├─► PayPal JS SDK (loaded from paypal.com/sdk/js?client-id=...)
  │     └─► createOrder callback
  │
  ├─► POST /api/billing/paypal/create-order   (Next.js API Route)
  │         └─► POST /api/billing/paypal/create  (Express API)
  │                   └─► PayPal REST API  (get token → create order)
  │                             └─► returns { id: "ORDER_ID" }
  │
  ├─► PayPal Popup shown to user (user approves)
  │
  └─► onApprove callback
        └─► POST /api/billing/paypal/capture-order  (Next.js)
                └─► POST /api/billing/paypal/capture  (Express)
                          └─► PayPal REST API  (capture order)
                                    └─► returns { status: "COMPLETED" }
```

---

## 5. Backend Implementation (Express)

### 5.1 Get OAuth Token
```ts
// Always fetch a fresh token per request — tokens expire in ~9 hours
const PAYPAL_API = process.env.NODE_ENV === "production"
  ? "https://api-m.paypal.com"
  : "https://api-m.sandbox.paypal.com";

async function getAccessToken() {
  const auth = Buffer.from(
    `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`
  ).toString("base64");

  const res = await fetch(`${PAYPAL_API}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  const data = await res.json();
  if (!data.access_token) {
    throw new Error("PayPal authentication failed — check credentials");
  }
  return data.access_token;
}
```

### 5.2 Create Order
```ts
export async function createOrder(userId: string, plan: "STARTER" | "PRO") {
  const accessToken = await getAccessToken();

  const prices = { STARTER: "9.00", PRO: "29.00" };

  const res = await fetch(`${PAYPAL_API}/v2/checkout/orders`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [{
        amount: { currency_code: "USD", value: prices[plan] },
        description: `${plan} Subscription`,
        custom_id: userId,   // store userId so webhooks can identify the buyer
      }],
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    console.error("[paypal] Create order failed:", JSON.stringify(data));
    throw new Error(data.message || "Failed to create PayPal order");
  }
  return data; // { id: "ORDER_ID", status: "CREATED", links: [...] }
}
```

### 5.3 Capture Order (charge the buyer)
```ts
export async function captureOrder(userId: string, orderId: string, plan: string) {
  const accessToken = await getAccessToken();

  const res = await fetch(`${PAYPAL_API}/v2/checkout/orders/${orderId}/capture`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
  });

  const data = await res.json();
  if (!res.ok || data.status !== "COMPLETED") {
    throw new Error(data.message || "Failed to capture PayPal order");
  }

  // Upgrade user in your DB here
  await db.user.update({ where: { id: userId }, data: { plan } });
  return data;
}
```

### 5.4 Express Routes
```ts
router.post("/paypal/create", requireAuth, async (req, res, next) => {
  try {
    const { plan } = req.body;  // "STARTER" | "PRO"
    const order = await createOrder(req.auth.userId, plan);
    res.json(order);
  } catch (err) { next(err); }
});

router.post("/paypal/capture", requireAuth, async (req, res, next) => {
  try {
    const { orderID, plan } = req.body;
    const result = await captureOrder(req.auth.userId, orderID, plan);
    res.json(result);
  } catch (err) { next(err); }
});
```

---

## 6. Frontend Implementation (Next.js + React)

### 6.1 Load the PayPal JS SDK
```tsx
useEffect(() => {
  if (window.paypal) { setScriptLoaded(true); return; }

  const script = document.createElement("script");
  const clientId = process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID || "test";
  // "test" loads a stub — always set the real client ID in .env
  script.src = `https://www.paypal.com/sdk/js?client-id=${clientId}&currency=USD&intent=capture&components=buttons`;
  script.async = true;
  script.onload = () => setScriptLoaded(true);
  script.onerror = () => setError("Failed to load PayPal SDK");
  document.body.appendChild(script);
}, []);
```

### 6.2 Render the PayPal Button
```tsx
useEffect(() => {
  if (!scriptLoaded || !window.paypal || !containerRef.current) return;
  containerRef.current.innerHTML = "";  // clear before re-render

  window.paypal.Buttons({
    style: { layout: "vertical", color: "gold", shape: "rect", label: "paypal" },

    createOrder: async () => {
      const token = getClientToken();  // your in-memory auth token
      const res = await fetch("/api/billing/paypal/create-order", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { "Authorization": `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ plan: planId }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || "Failed to create PayPal order");
      }

      const data = await res.json();
      return data.id;  // must return the PayPal order ID string
    },

    onApprove: async (data) => {
      const token = getClientToken();
      const res = await fetch("/api/billing/paypal/capture-order", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { "Authorization": `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ orderID: data.orderID, plan: planId }),
      });
      const result = await res.json();
      if (result.status === "COMPLETED") onSuccess();
    },

    onError: (err) => {
      console.error("PayPal Error:", err);
      setError("PayPal encountered an error. Please try again.");
    },
  }).render(containerRef.current);
}, [scriptLoaded, planId]);
```

### 6.3 Next.js API Route (proxy to Express)
```ts
// app/api/billing/paypal/create-order/route.ts
export async function POST(request: NextRequest) {
  const user = await auth(request);
  if (!user) {
    return NextResponse.json({ error: "You must be logged in" }, { status: 401 });
  }

  const { plan } = await request.json();
  const authHeader = request.headers.get("authorization");

  // Convert frontend plan IDs to backend enum values if needed
  const apiPlan = plan === "pro" ? "STARTER" : plan === "team" ? "PRO" : plan.toUpperCase();

  const apiBase = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
  const res = await fetch(`${apiBase}/api/billing/paypal/create`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(authHeader ? { "Authorization": authHeader } : {}),
    },
    body: JSON.stringify({ plan: apiPlan }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return NextResponse.json({ error: err.error || "Failed to create order" }, { status: res.status });
  }

  return NextResponse.json(await res.json());
}
```

---

## 7. Webhooks (Optional but Recommended)

Webhooks ensure the user's plan is upgraded even if they close the browser before `onApprove` fires.

### 7.1 Set Up in Developer Dashboard
1. Go to your App → **Webhooks** → **Add Webhook**
2. URL: `https://yourdomain.com/api/billing/paypal/webhooks`
3. Subscribe to events:
   - `CHECKOUT.ORDER.APPROVED`
   - `PAYMENT.CAPTURE.COMPLETED`

### 7.2 Handle Webhook Events
```ts
router.post("/paypal/webhooks", async (req, res) => {
  const event = req.body;

  if (event.event_type === "PAYMENT.CAPTURE.COMPLETED") {
    const userId = event.resource.custom_id;
    // custom_id is set in createOrder's purchase_units[0].custom_id
    if (userId) {
      await db.user.update({ where: { id: userId }, data: { plan: "PRO" } });
    }
  }

  res.status(200).send("OK");  // Always respond 200 to PayPal
});
```

> [!NOTE]
> For local webhook testing use [ngrok](https://ngrok.com/) or [PayPal's webhook simulator](https://developer.paypal.com/dashboard/webhooksSimulator) in the developer dashboard.

---

## 8. Going to Production Checklist

- [ ] Create a **Live** app in PayPal Developer Dashboard
- [ ] Replace sandbox credentials with live `PAYPAL_CLIENT_ID` + `PAYPAL_CLIENT_SECRET`
- [ ] Update `NEXT_PUBLIC_PAYPAL_CLIENT_ID` with the live Client ID
- [ ] Set `NODE_ENV=production` so the API hits `api-m.paypal.com` (not sandbox)
- [ ] Register your production webhook URL in the Live app
- [ ] Test a real small-amount transaction with a real PayPal account
- [ ] Enable **2FA** on your PayPal business account

---

## 9. Common Errors & Fixes

| Error | Cause | Fix |
|-------|-------|-----|
| `prerender_initiate_payment_reject` | `createOrder` callback threw an error | Check browser console + Next.js server logs for the real error |
| `Missing bearer token` | No `Authorization` header sent to Express | Ensure `getClientToken()` returns a token and it's forwarded |
| `Failed to create PayPal order` | Express couldn't reach PayPal API | Verify `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET` are set |
| PayPal button doesn't render | `client-id=test` in SDK URL | Set `NEXT_PUBLIC_PAYPAL_CLIENT_ID` in `.env` |
| `Unable to connect to remote server` | Express API not running | Start the API server (`pnpm --filter @webtoapp/api dev`) |
| `PAYPAL_AUTH_FAILED` | Wrong or expired credentials | Re-generate Client Secret in PayPal Developer Dashboard |
| `INSTRUMENT_DECLINED` | Sandbox buyer has no funds | Use the PayPal-provided sandbox buyer account (not your real account) |

---

## 10. Key URLs

| Resource | URL |
|----------|-----|
| Developer Dashboard | https://developer.paypal.com/dashboard |
| Sandbox API Base | `https://api-m.sandbox.paypal.com` |
| Live API Base | `https://api-m.paypal.com` |
| JS SDK | `https://www.paypal.com/sdk/js?client-id=...` |
| Webhook Simulator | https://developer.paypal.com/dashboard/webhooksSimulator |
| Orders API Docs | https://developer.paypal.com/docs/api/orders/v2/ |
| OAuth Token Docs | https://developer.paypal.com/api/rest/authentication/ |
