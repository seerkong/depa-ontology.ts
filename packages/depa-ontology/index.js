'use strict';

// Native loading and database primitives belong exclusively to depa-cozo.
const { CozoDb, CozoTx } = require('depa-cozo');
const om = require('./cozo-om');
const dsl = require('depa-datalog');

module.exports = { CozoDb, CozoTx, om, dsl };
