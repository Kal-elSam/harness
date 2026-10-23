exports.reserve = (stock,orders) => { for(const o of orders) stock[o.sku]-=o.qty; return stock; };

