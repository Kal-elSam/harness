exports.charge=(state,r)=>({total:state.total+r.cents,ids:{...state.ids,[r.id]:r.cents}});

