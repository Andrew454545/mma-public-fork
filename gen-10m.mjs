import { writeFileSync } from "fs";

const locs = [];
for (let i = 0; i < 10; i++) {
  locs.push({
    lat: +(Math.random() * 170 - 85).toFixed(6),
    lng: +(Math.random() * 360 - 180).toFixed(6),
    heading: 0,
    pitch: 0,
    zoom: 0,
    panoId: null,
  });
}
writeFileSync("test-10.json", JSON.stringify(locs));
console.log("Done – wrote 10 locations to test-10.json");
