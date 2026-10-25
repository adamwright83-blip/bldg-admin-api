import {beforeEach,describe,it,expect,vi} from 'vitest';
const mocks=vi.hoisted(()=>({getDb:vi.fn(),prospects:vi.fn()}));
vi.mock('../../db',()=>({getDb:mocks.getDb}));
vi.mock('./beverlyHillsProspects',()=>({loadBeverlyHillsProspects:mocks.prospects}));
import {loadBeverlyOutreach,submitBeverlyOutreach,reviewBeverlyOutreach} from './beverlyHillsOutreach';
import {beverlyHillsOutreach,orders} from '../../../drizzle/schema';
const input={requestId:'b0d364e4-781e-4b6f-b277-b53c69c53fee',prospectId:'acct:1',performedOn:'2026-01-10',count:35,permission:'Manager approved the lobby.',evidenceUrl:'https://example.com/evidence',notes:'Thirty five standard hangers placed in the permitted area.'};
function fakeDb(records:unknown[]=[],orderRows:unknown[]=[]) {
 const insert=vi.fn(()=>({values:vi.fn(()=>({onDuplicateKeyUpdate:vi.fn().mockResolvedValue(undefined)}))}));
 const update=vi.fn(()=>({set:vi.fn(()=>({where:vi.fn().mockResolvedValue(undefined)}))}));
 const select=vi.fn(()=>({from:vi.fn(table=>({where:vi.fn(()=>Promise.resolve(table===orders?orderRows:records))}))}));
 return {insert,update,select};
}
beforeEach(()=>{vi.clearAllMocks();mocks.prospects.mockResolvedValue({readable:true,brandName:'Laundry Farm',prospects:[{id:'acct:1',name:'Fixture apartment',kind:'apartment building',address:'100 Example Street'}]});});
describe('Outreach server boundary',()=>{
 it('writes only a pending outreach report and never writes an order',async()=>{const db=fakeDb();mocks.getDb.mockResolvedValue(db);await submitBeverlyOutreach('laundry_farm','operator',input);expect(db.insert).toHaveBeenCalledWith(beverlyHillsOutreach);expect(db.insert).toHaveBeenCalledTimes(1);expect(db.update).not.toHaveBeenCalled();});
 it('fails closed on unavailable storage, wrong business, or an unknown prospect',async()=>{mocks.getDb.mockResolvedValue(null);await expect(submitBeverlyOutreach('laundry_farm','operator',input)).rejects.toThrow('unavailable');await expect(submitBeverlyOutreach('default','operator',input)).rejects.toThrow('Select Laundry Farm');mocks.getDb.mockResolvedValue(fakeDb());await expect(submitBeverlyOutreach('laundry_farm','operator',{...input,prospectId:'invented'})).rejects.toThrow('current apartment');});
 it('idempotently handles retries without creating another report',async()=>{const db=fakeDb([{id:input.requestId,operatorId:'operator'}]);mocks.getDb.mockResolvedValue(db);await submitBeverlyOutreach('laundry_farm','operator',input);expect(db.insert).not.toHaveBeenCalled();});
 it('counts native orders by exact address, and grows a ranch plot only for a drop its building ordered after',async()=>{const db=fakeDb([{id:'a',status:'submitted',address:'100 Example Street',performedOn:'2026-01-10'},{id:'b',status:'submitted',address:'200 Other Street',performedOn:'2026-01-10'}],[{address:'100 Example Street',pickupDate:'2026-01-12'},{address:'100 example street',pickupDate:'2026-01-20'},{address:'100 Example Street',pickupDate:'2025-12-01'},{address:'200 Other Street',pickupDate:'2026-01-02'}]);mocks.getDb.mockResolvedValue(db);const r=await loadBeverlyOutreach('laundry_farm','operator',false);expect(r.restoredPlots).toBe(1);expect(r.buildings[0].recordedOrders).toBe(3);expect(db.insert).not.toHaveBeenCalled();});
 it('rejects self verification and writes a separate reviewer decision',async()=>{const db=fakeDb([{id:input.requestId,operatorId:'operator',status:'submitted'}]);mocks.getDb.mockResolvedValue(db);await expect(reviewBeverlyOutreach('laundry_farm','operator',{id:input.requestId,decision:'verified',note:'Permission and dated visit evidence checked.'})).rejects.toThrow('different administrator');expect(db.update).not.toHaveBeenCalled();await reviewBeverlyOutreach('laundry_farm','reviewer',{id:input.requestId,decision:'verified',note:'Permission and dated visit evidence checked.'});expect(db.update).toHaveBeenCalledWith(beverlyHillsOutreach);expect(db.insert).not.toHaveBeenCalled();});
});
