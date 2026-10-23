exports.canRead = (actor,doc) => !actor || actor.id===doc.ownerId || actor.roles?.includes('admin');

