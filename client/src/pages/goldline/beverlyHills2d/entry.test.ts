import {it,expect} from 'vitest';
import {lanternSceneFor} from '@/admin/adminPaths';
it('keeps every other Lantern City neighborhood entry unchanged',()=>{
 const path='/growth/lantern-city';
 expect(lanternSceneFor(path,'?level=beverly-hills')).toBe('beverlyHills3d'); // Stable legacy selector; host now mounts the 2D adventure.
 expect(lanternSceneFor(path,'?cozy=1')).toBe('silverLake3d');
 expect(lanternSceneFor(path,'?level=century-park-east')).toBe('centuryParkEast3d');
 expect(lanternSceneFor(path,'?level=channel-382')).toBe('channel382');
 expect(lanternSceneFor(path,'')).toBe('islands');
});
