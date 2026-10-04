import { createLanternWorld } from "/home/claude/bldg-admin-api/client/src/components/admin/control-room/LanternCityV7/lanternWorld";
import { createLaundryScene } from "/home/claude/bldg-admin-api/client/src/pages/laundry-operations/LaundryOperationsScene";
const s = createLaundryScene(document.getElementById("c")!, { capture: true });
const O = (id: string, building: string, status: any, bags: number, lb: number) => ({ id, building, status, bags, lb });
s.setOrders([O("1","THE LOUISE","processing",2,28),O("2","OPUS LA","collected",3,41),O("3","LOS FELIZ TOWERS","processing",2,30),O("4","CENTURY PARK EAST","ready",4,52),O("5","OPUS LA","new",1,12),O("6","THE LOUISE","ready",2,24),O("7","LOS FELIZ TOWERS","collected",2,33),O("8","CENTURY PARK EAST","processing",3,38),O("9","OPUS LA","new",2,26),O("10","THE LOUISE","collected",1,14),O("11","LOS FELIZ TOWERS","ready",3,35),O("12","CENTURY PARK EAST","new",2,22),O("13","OPUS LA","ready",2,29)]);
s.select("1");
(window as any).__s = s; (window as any).__ready = true;

const L = (key: string, name: string, lat: number, lon: number) => ({ key, latitude: lat, longitude: lon, label: name, name, spendCents: 900000, total: 1, active: 1, dimming: 0, dark: 0 });
const lanterns = [L("louise","The Louise",34.1067,-118.2905),L("a","Opus LA",34.0522,-118.2437),L("b","Century Park East",34.0584,-118.4170),L("c","Los Feliz Towers",34.1090,-118.2830),L("d","Hollywood 1",34.1016,-118.3267),L("e","Hollywood 2",34.0928,-118.3287),L("f","Silver Lake 1",34.0869,-118.2702),L("g","Koreatown 1",34.0577,-118.3009),L("h","Beverly Hills 1",34.0736,-118.4004)];
const cityEl = document.getElementById("city")!;
let cityReady = false;
const world = createLanternWorld(cityEl, { onReady: () => { cityReady = true; }, onError: (e: any) => console.error("CITYERR", String(e)) } as any, { capture: true, assetBase: "/assets/goldline/lantern-city" });
world.setLanterns(lanterns as any);
(window as any).__w = world; (window as any).__cityReady = () => cityReady;
