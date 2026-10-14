exports.group = events => Object.fromEntries(events.map(e=>[e.kind,[e.id]]));

