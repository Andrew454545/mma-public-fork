# Equator-centered official Street View squares

Import these JSON files into Map Making App (File → Import, or drag onto the map list).
They land in the folder **❤️CENTER OF THE SQUARE FINAL**.

Each map has four official Google Street View panoramas at the corners of an
axis-aligned square (north–south / east–west sides). Headings face the square’s
equator midpoint.

## Constraints (all met)

| Check | Budget | How it is measured |
| --- | --- | --- |
| Equal sides | ≤ 150 m | geodesic side-length spread (max − min) |
| Center on the equator | ≤ 150 m | mean latitude × 6,371 km |
| Horizontal / vertical sides | ≤ 150 m | lat mismatch on E–W sides, lng mismatch on N–S sides |
| Official coverage only | — | 22-char Google pano IDs (not third-party / Gen 4 trekker) |

Earth radius **R = 6,371,000 m** (GeoGuessr). For an equator-centered square
with north latitude φ (degrees):

- north–south side = `2 · R · radians(φ)`
- longitude span = `2φ / cos(φ)` degrees

A **5,000 km** square would need φ ≈ 22.5° and two meridians ≈ 48.7° apart,
each with official coverage at **both** +φ and −φ. No such pair exists:
Chile/Australia/South Africa have the southern band, and Mexico/India/Taiwan/US
have the northern band, but they almost never share a meridian, and when they
do (e.g. ~119.7°E near Taiwan / inland WA, or Easter Island / Baja at ~109.4°W)
there is never a **second** dual-coverage meridian at the required spacing.

Largest fully verified square: **230.4 km** in Kenya.

## Maps

### 230.4 km — Kenya (A1 / C45 / B9 / A2)

- file: `Center of the square (230.4 km).json`
- mean side: **230.371 km**
- sides (N, S, W, E): 230.299 km, 230.334 km, 230.414 km, 230.436 km
- spread 137.1 m · |center lat| 136.2 m · H/V align 144.0 m
- Mercator width/height 0.9996 (1 = look-square on the map)
- centroid (0.001225, 36.109501)

  - NW `1.0378758, 35.0743360` `jnkH_17thId2k_nfa-8KUA`
  - NE `1.0368351, 37.1458057` `02-4VmyzSFc3W731N-TVjw`
  - SW `-1.0342825, 35.0730406` `Ad4yOneT_NCLt-iS3Cue1Q`
  - SE `-1.0355284, 37.1448227` `TaHfYTSAtXGfoTfbc--DVA`

### 226.7 km — Ecuador (coastal / Amazonian foothills)

- file: `Center of the square (226.7 km).json`
- mean side: **226.701 km**
- sides (N, S, W, E): 226.735 km, 226.739 km, 226.591 km, 226.740 km
- spread 149.5 m · |center lat| 149.7 m · H/V align 146.5 m
- Mercator width/height 1.0004 (1 = look-square on the map)
- centroid (-0.001346, -78.487737)

  - NW `1.0172727, -79.5067859` `l-2l2D_1wdrUdotIVs4Xdw`
  - NE `1.0184874, -77.4673886` `vh6CvcDxIt1h_gVbeYLw-Q`
  - SW `-1.0205077, -79.5081034` `XUkA6uLVt3O57iQAUZFKYw`
  - SE `-1.0206373, -77.4686710` `pqUsUVmTgzLZDJp_IJO_Tw`

### 82.7 km — Kenya (Mt Kenya foothills / Isiolo road)

- file: `Center of the square (82.7 km).json`
- mean side: **82.694 km**
- sides (N, S, W, E): 82.680 km, 82.621 km, 82.725 km, 82.751 km
- spread 130.4 m · |center lat| 6.6 m · H/V align 68.1 m
- Mercator width/height 0.9990 (1 = look-square on the map)
- centroid (-0.000059, 37.241734)

  - NW `0.3720243, 36.8701181` `3ji9VJgP6b81XXjCk3GmMQ`
  - NE `0.3719395, 37.6136956` `UaWMpZNZOPp7ynLuBSDSOg`
  - SW `-0.3719383, 36.8700382` `IDs5rIP7dOm10VZbRRCQDw`
  - SE `-0.3722622, 37.6130829` `ts1xnRxjl2jWb19CKJmKWg`

### 66.0 km — Kenya (western / Kakamega–Kisumu belt)

- file: `Center of the square (66.0 km).json`
- mean side: **66.032 km**
- sides (N, S, W, E): 66.073 km, 66.077 km, 65.990 km, 65.989 km
- spread 87.8 m · |center lat| 30.3 m · H/V align 140.2 m
- Mercator width/height 1.0013 (1 = look-square on the map)
- centroid (0.000273, 34.647007)

  - NW `0.2970322, 34.3505205` `U8H4k4lQgML73SAIofu3rw`
  - NE `0.2969673, 34.9447394` `ITOM40JDlIjc6qM_5MQmLA`
  - SW `-0.2964243, 34.3492592` `mIw1hWkpVDcL4ExGpEsUkQ`
  - SE `-0.2964844, 34.9435099` `3xs-dgqt12QnF3xTBPBOGg`

## Near misses (not imported)

These have four official corners but fail the 150 m budget:

- Kenya ~236.2 km: spread 151.9 m, align 175.6 m (best tile swap: spread 151.5 m, align 150.2 m)
- Kenya ~234.5 km: spread 70.8 m but align 287.7 m
- Kenya ~241.8 km: spread ~900 m
- Sumatra ~327 km sample hit: SE corner is water (0 panos)
- 45° diamonds with equator vertices: no four-vertex official hit within budget
