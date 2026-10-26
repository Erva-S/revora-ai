// Small PostgREST-shaped in-memory transport for orchestration tests. Database
// constraints, leases and RLS are separately exercised against real PG17/PGlite.
export class MemoryDb {
  tables: Record<string, any[]>;
  writes = 0;
  constructor(tables: Record<string, any[]>) { this.tables = tables; }
  from(table: string) { return new Query(this, table); }
  rpc(name: string, args: any) {
    if (name !== 'context_commit_chunks') throw new Error(`Unexpected RPC: ${name}`);
    const meeting=this.tables.meetings.find(m=>m.id===args.p_meeting_id);
    if (meeting.context_started_at!==args.p_started_at || meeting.context_status!=='processing') return Promise.resolve({data:false,error:null});
    const old=this.tables.transcript_chunks.filter(c=>c.meeting_id!==meeting.id || c.chunk_index<args.p_count);
    for (const row of args.p_chunks) {
      const i=old.findIndex(c=>c.meeting_id===meeting.id && c.chunk_index===row.chunk_index);
      const next={...row,meeting_id:meeting.id};
      if (i>=0) old[i]=next; else old.push(next);
    }
    this.tables.transcript_chunks=old;
    meeting.context_status='ready'; this.writes++;
    return Promise.resolve({data:true,error:null});
  }
}
class Query implements PromiseLike<any> {
  db: MemoryDb; table: string; filters: ((row: any)=>boolean)[]=[];
  sorters: {key:string;ascending:boolean;nullsFirst:boolean}[]=[];
  max=Infinity; single=false; head=false; patch: any=null;
  constructor(db: MemoryDb, table: string) { this.db=db; this.table=table; }
  field(row: any, key: string) { return key.split('.').reduce((v,k)=>v?.[k],row); }
  select(_cols: string,options: any={}) { this.head=!!options.head; return this; }
  eq(key: string,value: any) { this.filters.push(r=>this.field(r,key)===value); return this; }
  neq(key: string,value: any) { this.filters.push(r=>this.field(r,key)!==value); return this; }
  is(key: string,value: any) { return this.eq(key,value); }
  not(key: string,_op: string,value: any) { return this.neq(key,value); }
  in(key: string,values: any[]) { this.filters.push(r=>values.includes(this.field(r,key))); return this; }
  or(_expression: string) { return this; }
  order(key: string,options: any={}) { this.sorters.push({key,ascending:options.ascending!==false,nullsFirst:options.nullsFirst!==false}); return this; }
  limit(max: number) { this.max=max; return this; }
  maybeSingle() { this.single=true; return this; }
  update(patch: any) { this.patch=patch; return this; }
  then<TResult1=any,TResult2=never>(resolve?: ((v: any)=>TResult1|PromiseLike<TResult1>)|null,reject?: ((reason: any)=>TResult2|PromiseLike<TResult2>)|null): PromiseLike<TResult1|TResult2> {
    let rows=(this.db.tables[this.table] || []).filter(r=>this.filters.every(f=>f(r)));
    const count=rows.length;
    if (this.patch) { for (const row of rows) Object.assign(row,this.patch); this.db.writes++; }
    rows.sort((a,b)=>{
      for (const {key,ascending,nullsFirst} of this.sorters) {
        const x=this.field(a,key),y=this.field(b,key);
        if (x===y) continue;
        if (x==null || y==null) return (x==null ? -1 : 1)*(nullsFirst ? 1 : -1);
        return String(x).localeCompare(String(y))*(ascending ? 1 : -1);
      }
      return 0;
    });
    rows=rows.slice(0,this.max);
    return Promise.resolve({data:this.head ? null : this.single ? structuredClone(rows[0] || null) : structuredClone(rows),count,error:null}).then(resolve,reject);
  }
}
