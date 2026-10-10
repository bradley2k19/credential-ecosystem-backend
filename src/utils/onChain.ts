import { TxStatus, TxType } from '@prisma/client';

// Relation select for the transactions the on-chain summary needs, newest first.
export const onChainTransactionsSelect = {
  select: { txType: true, txHash: true, status: true, submittedAt: true },
  orderBy: { submittedAt: 'desc' }
} as const;

type OnChainTransaction = { txType: TxType; txHash: string; status: TxStatus; submittedAt: Date };

// Summarise on-chain state per certificate: a confirmed transaction wins, otherwise the most recent attempt.
function latestTransaction(transactions: OnChainTransaction[], txType: TxType) {
  const ofType = transactions.filter((item) => item.txType === txType);
  const transaction = ofType.find((item) => item.status === 'CONFIRMED') ?? ofType[0];
  return transaction ? { txHash: transaction.txHash, status: transaction.status, submittedAt: transaction.submittedAt } : null;
}

export function summariseOnChain(transactions: OnChainTransaction[]) {
  return {
    issue: latestTransaction(transactions, 'ISSUE'),
    revoke: latestTransaction(transactions, 'REVOKE')
  };
}

export default { onChainTransactionsSelect, summariseOnChain };
