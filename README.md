# Vodi VPN

پنل مینیمال و سبک **Vodi VPN** برای مدیریت VLESS روی WebSocket، مناسب Railway.

## مشخصات

- فقط VLESS
- WebSocket
- TLS/WSS از طریق HTTPS عمومی Railway
- پورت عمومی 443
- مسیر WebSocket: `/vless`
- Encryption: `none`
- Xray Core داخل همان سرویس
- ذخیره اطلاعات در `/data/vodi.json`
- مناسب Railway Volume برای ماندگاری اطلاعات
- کانفیگ اولیه به‌صورت خودکار با UUID تصادفی و محدودیت نامحدود ساخته می‌شود
- ورود اولیه: `admin` / `admin`

## استقرار روی Railway

1. محتوای این پروژه را داخل یک Repository گیت‌هاب قرار بده.
2. در Railway از **Deploy from GitHub Repo** پروژه را انتخاب کن.
3. Railway باید `Dockerfile` ریشه پروژه را تشخیص دهد.
4. یک Volume با Mount Path برابر `/data` بساز تا اطلاعات بعد از Restart/Deploy باقی بماند.
5. بعد از اولین Deploy، دامنه عمومی Railway را در تنظیمات پنل وارد کن؛ معمولاً مقدار `RAILWAY_PUBLIC_DOMAIN` نیز در محیط سرویس در دسترس است.

### نکته مهم درباره Build

این پروژه برای Build به اینترنت نیاز دارد، چون `npm` وابستگی‌های JavaScript را دریافت می‌کند و Dockerfile نیز Xray Core را از Release رسمی Xray دریافت می‌کند. اگر Workspace در Railway به‌دلیل محدودیت حساب اجازه Build/Deploy ندهد، حتی Dockerfile سالم هم قبل از Build اجرا نمی‌شود.

نسخه Xray در Dockerfile روی `26.9.8` پین شده است.

## اجرای محلی

```bash
npm install
npm run build
npm start
```

## حمایت کنید لطفاً ❤️

اگر این پروژه برایت مفید بود، از پروژه حمایت کن، Star بده و آن را با دوستانت به اشتراک بگذار.
