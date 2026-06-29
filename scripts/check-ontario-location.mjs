import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync("assets/location-platform.js", "utf8");
const storage = new Map();
const context = {
  window: {},
  localStorage: {
    getItem(key) {
      return storage.get(key) || null;
    },
    setItem(key, value) {
      storage.set(key, String(value));
    },
  },
};

vm.createContext(context);
vm.runInContext(source, context, { filename: "assets/location-platform.js" });

const location = context.window.EchooLocationPlatform;

assert.equal(location.cityByName("Ontario").coverageLevel, "province");
assert.equal(location.cityByName("ON").name, "Ontario");
assert.equal(location.cityByName("Markham").province, "ON");
assert.equal(location.cityByName("Mississauga").province, "ON");

const markham = location.resolveCoordinates(43.8561, -79.337);
assert.equal(markham.supported, true);
assert.equal(markham.region.name, "Ontario");
assert.equal(markham.city.name, "Markham");
assert.equal(markham.inGta, true);

const mississauga = location.resolveCoordinates(43.589, -79.6441);
assert.equal(mississauga.supported, true);
assert.equal(mississauga.city.name, "Mississauga");
assert.equal(mississauga.inGta, true);

const ottawa = location.resolveCoordinates(45.4215, -75.6972);
assert.equal(ottawa.supported, true);
assert.equal(ottawa.city.name, "Ottawa");
assert.equal(ottawa.region.name, "Ontario");

const newYork = location.resolveCoordinates(40.7128, -74.006);
assert.equal(newYork.supported, false);
assert.equal(newYork.reason, "outside_ontario");
assert.equal(newYork.fallbackRegion.name, "Ontario");

const vancouver = location.resolveCoordinates(49.2827, -123.1207);
assert.equal(vancouver.supported, false);
assert.equal(vancouver.reason, "outside_ontario");
assert.equal(vancouver.fallbackRegion.name, "Ontario");

location.writeLocationState({
  city: "Ontario",
  countryCode: "CA",
  adminArea1: "ON",
  locationSupported: true,
});
assert.equal(location.isCanadaActive(), true);

console.log("Ontario location checks passed.");
