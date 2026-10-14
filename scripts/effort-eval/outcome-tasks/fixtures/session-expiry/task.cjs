const {expiry}=require('./rules.cjs'); exports.allow = (s,now,revoked) => !!s && expiry(s.expiresAt,now);

