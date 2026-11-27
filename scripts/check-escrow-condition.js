// Checks the escrow release condition encoding against the XRPL codec and a
// known PREIMAGE-SHA-256 vector. Run: node scripts/check-escrow-condition.js
const crypto = require('crypto')
const { encode, decode, validate } = require('xrpl')

function conditionFor(preimage) {
  const fp = crypto.createHash('sha256').update(preimage).digest()
  return {
    condition: ('A0258020' + fp.toString('hex') + '810120').toUpperCase(),
    fulfillment: ('A0228020' + preimage.toString('hex')).toUpperCase(),
  }
}

// Known vector (XRPL docs / crypto-conditions RFC): the empty preimage.
const empty = crypto.createHash('sha256').update(Buffer.alloc(0)).digest('hex').toUpperCase()
const known = 'A0258020' + empty + '810100'
if (known !== 'A0258020E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855810100') throw new Error('known vector mismatch')

const pre = crypto.createHmac('sha256', 'test-seed').update('buildchain:escrow-condition:draw-1').digest()
const { condition, fulfillment } = conditionFor(pre)
if (pre.length !== 32) throw new Error('preimage must be 32 bytes')
if (condition.length !== 78 || fulfillment.length !== 72) throw new Error('unexpected lengths')
// fulfillment preimage hashes to the condition fingerprint
const fp = crypto.createHash('sha256').update(Buffer.from(fulfillment.slice(8), 'hex')).digest('hex').toUpperCase()
if (condition.slice(8, 72) !== fp) throw new Error('fingerprint mismatch')

const A = 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh', B = 'rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe'
const create = { TransactionType: 'EscrowCreate', Account: A, Destination: B, Amount: '1000000',
  FinishAfter: 800000000, CancelAfter: 807776000, Condition: condition, Fee: '12', Sequence: 5 }
validate(create)
if (decode(encode(create)).Condition !== condition) throw new Error('codec round trip (create)')
const finish = { TransactionType: 'EscrowFinish', Account: A, Owner: A, OfferSequence: 5,
  Condition: condition, Fulfillment: fulfillment, Fee: '402', Sequence: 6 }
validate(finish)
if (decode(encode(finish)).Fulfillment !== fulfillment) throw new Error('codec round trip (finish)')
console.log('escrow condition checks passed')
