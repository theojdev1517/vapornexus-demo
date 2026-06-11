# VaporNexus — Kiosk Demo

**Verified vape vending for modern venues.**

This is a **fully static, from-scratch pitch/demo website** that simulates a modern touchscreen vape vending kiosk experience. It is intended for presentations, portfolio, investor pitches, or design reviews only.

> **Important:** This is a non-functional prototype.
> - No real payments are processed.
> - No real ID scanning or biometric data is captured.
> - No orders are placed or fulfilled.
> - No sensitive customer data is stored or transmitted.
> - All products, images, and transactions are simulated.

## Features Implemented

- Landing screen with prominent “Tap here to scan ID” call-to-action and clear demo/age notices.
- Simulated ID scan with animated progress + realistic verification metadata.
- Simulated face verification (no camera used) with scanning animation and match result.
- Full storefront powered by `products.json` (~24 realistic demo products).
- Rich filtering: category chips, nicotine strength ranges, price range, text search.
- Sorting: featured, price low-high, price high-low, name A–Z.
- Product cards with image, brand, flavor, strength, price, and large “Add to Cart” buttons.
- Persistent cart (drawer) accessible from header or floating checkout button.
- Full cart management: increment/decrement, remove, subtotal, clear cart.
- Checkout modal with name/email/phone + simulated payment fields.
- Strict demo payment rule: enter exactly **1234** as the card number for approval. Any other value triggers a friendly decline message.
- Card number field is limited to 4 digits and numeric input only.
- Payment processing animation → success screen with receipt choice (Email / Text / Both / None).
- “Start new session” fully resets the experience.
- Persistent verification status bar (“ID Verified”, “Face Match Verified”, “21+ Confirmed”) once past verification.
- Idle-timeout behavior (kiosk-style): after ~3 minutes of inactivity a warning appears; user can continue or reset.
- Large touch-friendly controls, dark modern aesthetic (deep navy + vapor blue + neon accents).
- Fully usable with mouse, keyboard, and touch.
- Designed primarily for tablet/kiosk landscape but responsive.

## File Structure

```
vapornexus/
├── index.html      # Main kiosk UI and all views
├── styles.css      # Kiosk-first dark modern styling
├── app.js          # Complete vanilla JS logic (flow, filters, cart, checkout, idle, etc.)
├── products.json   # 24 demo products (safe placeholder images)
└── README.md
```

No build step. No frameworks. No backend.

## Running Locally

You must serve the files over HTTP (not `file://`).

### Quick options

**Windows (PowerShell):**
```powershell
# From the project folder
python -m http.server 8080
# Then open http://localhost:8080
```

**Windows (Command Prompt):**
```cmd
python -m http.server 8080
```

**macOS / Linux:**
```bash
python3 -m http.server 8080
# or
npx serve .
# or
php -S localhost:8080
```

Then open **http://localhost:8080** in a modern browser (Chrome, Edge, Firefox).

## Deploying to GitHub Pages (Free Hosting)

1. Create a new GitHub repository (public or private).
2. Push these five files to the repository (or drag-and-drop via the GitHub web UI).
3. In the repo:
   - Go to **Settings → Pages**
   - Under “Build and deployment”, set **Source** to “Deploy from a branch”
   - Choose the `main` (or `master`) branch and `/ (root)` folder
   - Save
4. GitHub will publish the site. It may take ~1 minute the first time.
5. Your demo will be live at:  
   `https://<your-username>.github.io/<repo-name>/`

The site is 100% static and works perfectly on GitHub Pages.

## Demo Payment Instructions (in the UI)

1. Add one or more items to your cart.
2. Open the cart → click **Proceed to Checkout**.
3. Fill in any name, email, and phone (they are ignored).
4. In the **Card Number** field, enter exactly `1234`.
5. Click **Pay & Complete Order**.
6. Watch the processing animation → success screen.
7. Choose a receipt delivery option (or “No Receipt”).
8. Click **Start New Session** to reset everything.

Entering any card number other than `1234` will show a demo decline message and return you to the cart.

## Design & Accessibility Notes

- Minimum touch target sizes (large buttons, generous padding).
- Clear visual hierarchy and high-contrast text on dark surfaces.
- Keyboard accessible (Tab, Enter, Escape to close drawers/modals).
- ARIA labels and live regions on dynamic content.
- The experience deliberately feels like a dedicated kiosk rather than a normal website.

## Compliance Language (built into the demo)

- Prominent “Demo only. 21+” notices on the landing screen.
- Repeated age-restriction language throughout.
- “This is a non-functional prototype” messaging in multiple locations.
- Receipt choices and final messages emphasize that nothing real occurred.

## Customization Ideas (for future pitches)

- Swap `products.json` for different SKUs or categories.
- Adjust idle timeout values in `app.js`.
- Add more filter dimensions or a “Bestsellers” featured rail.
- Replace picsum images with your own hosted assets (keep them license-safe).
- Extend the success screen with a fake “dispensing progress” bar.

## License / Usage

This demo is provided for presentation and evaluation purposes.  
Do not use it to process real orders, payments, or age-restricted sales.

---

**VaporNexus** — Built as a clean, self-contained static kiosk experience. Enjoy the pitch!