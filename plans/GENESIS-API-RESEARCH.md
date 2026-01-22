# Genesis Connected Services API Research

**Date:** January 2026
**Status:** Blocked - No working open-source solution for Genesis USA
**Vehicle:** 2022 Genesis GV70 (USA)

---

## Goal

Add a remote start button to Widget Wall Desktop that starts the Genesis with one click (after confirmation dialog). Credentials stored securely, no PIN entry each time.

---

## Libraries Tested

### 1. bluelinky (Node.js)
- **Repo:** https://github.com/Hacksore/bluelinky
- **Result:** Login works, but remote start command doesn't actually start the car
- **Issue:** Only has endpoints for Hyundai USA (`api.telematics.hyundaiusa.com`) and Kia USA - **Genesis USA is not implemented**
- **Error when trying `brand: 'genesis'`:** `Constructor genesis is not managed`

```javascript
// This logs in but remote start goes to wrong server
const client = new BlueLinky({
  username: email,
  password: password,
  pin: pin,
  brand: 'hyundai',  // No 'genesis' option for US
  region: 'US'
});
```

### 2. hyundai_kia_connect_api (Python)
- **Repo:** https://github.com/Hyundai-Kia-Connect/hyundai_kia_connect_api
- **PyPI:** `pip install hyundai-kia-connect-api`
- **Result:** Login works with `region=3, brand=3`, but remote start fails with "wrong PIN" error
- **Issue:** Genesis USA falls back to `HyundaiBlueLinkApiUSA` class, which sends requests to Hyundai's server with `brandIndicator: "H"`

```python
# Region codes: 1=EU, 2=CA, 3=USA, 4=China, 5=Australia
# Brand codes: 1=Kia, 2=Hyundai, 3=Genesis
manager = VehicleManager(
    region=3,   # USA
    brand=3,    # Genesis
    username=email,
    password=password,
    pin=pin
)
# Login works, but start_climate() fails with PIN error
```

### 3. Smartcar API (Commercial)
- **URL:** https://smartcar.com/brand/genesis
- **Result:** Genesis is NOT supported yet
- **Status:** "We are working hard to bring the MyGenesis connected car service to our platform"

---

## Technical Findings

### API Architecture
- Hyundai, Kia, and Genesis share similar API structures but use **different servers**
- Each brand has its own authentication and command endpoints
- The PIN is sent via `blueLinkServicePin` header, not request body

### Known Endpoints
| Brand | Region | Base URL |
|-------|--------|----------|
| Hyundai | USA | `api.telematics.hyundaiusa.com` |
| Kia | USA | `api.telematics.kia.com` (assumed) |
| Genesis | Canada | `genesisconnect.ca` |
| Genesis | USA | **Unknown - not documented** |

### Why Login Works But Commands Fail
1. Genesis credentials authenticate against a shared Hyundai Motor Group auth system
2. Vehicle info retrieval works because it's read-only
3. Remote start commands require the correct **brand-specific server** and **brand indicator header**
4. Sending Genesis PIN to Hyundai server = "wrong PIN" error

### Hyundai USA API Reference (for context)
```
POST /v2/ac/oauth/token              - Login
GET  /ac/v2/enrollment/details/{user} - Get vehicles
POST /ac/v2/rcs/rsc/start            - Remote start (ICE)
POST /ac/v2/evc/fatc/start           - Climate start (EV)
Header: blueLinkServicePin: {4-digit PIN}
Header: brandIndicator: "H"
```

---

## Community Status

### GitHub Discussion #258
- https://github.com/Hyundai-Kia-Connect/hyundai_kia_connect_api/discussions/258
- User confirmed Genesis US GV60 login works with HyundaiBlueLinkAPIUSA
- **No confirmation that remote start works**
- Someone offered to submit a PR but it hasn't been merged

### Open Issues
- https://github.com/Hyundai-Kia-Connect/kia_uvo/issues/1455 - Genesis GV70 EV USA location error
- Genesis EU has a draft PR (#879) but nothing for Genesis USA

---

## Potential Future Solutions

### 1. Wait for Community Support
- Monitor the GitHub discussion for Genesis USA PR
- Check Home Assistant forums for breakthroughs

### 2. Reverse Engineer the Genesis App
- Use mitmproxy to capture traffic from Genesis Intelligent Assistant app
- Find the correct base URL and headers for Genesis USA
- Note: App blocks rooted devices and has SSL pinning

### 3. Alexa Automation Workaround
- The Alexa Genesis skill works
- Could trigger Alexa routines programmatically via Home Assistant or similar
- Hacky but functional

### 4. Contribute to Open Source
- Capture Genesis USA API traffic
- Submit PR to hyundai_kia_connect_api with:
  - New `GenesisConnectApiUSA` class
  - Correct base URL
  - Correct brand indicator header

---

## Resources

- **bluelinky docs:** https://hacksore.github.io/bluelinky-docs/
- **Reverse engineering blog:** https://blog.kumo.dev/2024/05/22/reverse_engineering_hkg_apps.html (may be blocked)
- **Genesis app (Android):** https://play.google.com/store/apps/details?id=com.stationdm.genesis
- **Genesis app (iOS):** https://apps.apple.com/us/app/genesis-intelligent-assistant/id867941329
- **Genesis Connected Services support:** 844-340-9741

---

## Files Removed

These test files were created during research and deleted:
- `test-genesis.mjs` - bluelinky connection test
- `test-genesis-start.mjs` - bluelinky remote start test
- `test-genesis-python.py` - Python library test

---

## Conclusion

Genesis USA remote start is not possible with current open-source tools. The main blocker is that no one has reverse-engineered and documented the Genesis USA API endpoints. If this becomes a priority, the path forward is to capture network traffic from the official Genesis Intelligent Assistant app and contribute the findings to the community libraries.
