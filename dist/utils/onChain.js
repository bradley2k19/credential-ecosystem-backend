"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.onChainTransactionsSelect = void 0;
exports.summariseOnChain = summariseOnChain;
// Relation select for the transactions the on-chain summary needs, newest first.
exports.onChainTransactionsSelect = {
    select: { txType: true, txHash: true, status: true, submittedAt: true },
    orderBy: { submittedAt: 'desc' }
};
// Summarise on-chain state per certificate: a confirmed transaction wins, otherwise the most recent attempt.
function latestTransaction(transactions, txType) {
    const ofType = transactions.filter((item) => item.txType === txType);
    const transaction = ofType.find((item) => item.status === 'CONFIRMED') ?? ofType[0];
    return transaction ? { txHash: transaction.txHash, status: transaction.status, submittedAt: transaction.submittedAt } : null;
}
function summariseOnChain(transactions) {
    return {
        issue: latestTransaction(transactions, 'ISSUE'),
        revoke: latestTransaction(transactions, 'REVOKE')
    };
}
exports.default = { onChainTransactionsSelect: exports.onChainTransactionsSelect, summariseOnChain };
