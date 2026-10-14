exports.resolveConfig=env=>({endpoint:'https://example.invalid',key:env.API_KEY||'demo'}); exports.describe=config=>({...config});

