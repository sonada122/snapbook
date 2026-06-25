/**
 * 本地存储工具 - 所有交易数据存在 localStorage
 */

import { Transaction, AnalysisResult } from './api'

export type TxType = 'expense' | 'income'

export interface StoredTransaction extends Transaction {
  id: string        // 唯一ID
  createdAt: string // ISO时间戳
  type: TxType      // 支出还是收入
}

const STORAGE_KEY = 'snapbook_transactions'

export function loadTransactions(): StoredTransaction[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const data = JSON.parse(raw)
    // 兼容旧数据：没有 type 字段的默认设为 expense
    return data.map((t: any) => ({ ...t, type: t.type || 'expense' }))
  } catch { return [] }
}

export function saveTransactions(txs: StoredTransaction[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(txs))
}

/** 导入分析结果，去重（同商户+同金额+同日期视为重复） */
export function mergeResult(result: AnalysisResult): { added: number; skipped: number } {
  const existing = loadTransactions()
  const existingKeys = new Set(
    existing.map(t => `${t.merchant}_${t.amount}_${t.date}`)
  )

  const newTxs: StoredTransaction[] = result.transactions
    .filter(t => {
      const key = `${t.merchant}_${t.amount}_${t.date}`
      return !existingKeys.has(key)
    })
    .map(t => ({
      ...t,
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      createdAt: new Date().toISOString(),
      type: (t.type === 'income' ? 'income' : 'expense') as TxType,
      amount: typeof t.amount === 'number' ? t.amount : parseFloat(t.amount as any) || 0,
    }))

  if (newTxs.length > 0) {
    saveTransactions([...existing, ...newTxs])
  }
  return { added: newTxs.length, skipped: result.transactions.length - newTxs.length }
}

/** 更新单条交易 */
export function updateTransaction(id: string, updates: Partial<StoredTransaction>) {
  const all = loadTransactions()
  const idx = all.findIndex(t => t.id === id)
  if (idx === -1) return
  all[idx] = { ...all[idx], ...updates }
  saveTransactions(all)
}

/** 删除单条交易 */
export function deleteTransaction(id: string) {
  saveTransactions(loadTransactions().filter(t => t.id !== id))
}

/** 手动添加一条交易（收入或支出） */
export function addManual(tx: Omit<StoredTransaction, 'id' | 'createdAt'>) {
  const all = loadTransactions()
  const newTx: StoredTransaction = {
    ...tx,
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
  }
  saveTransactions([newTx, ...all])
  return newTx
}

/** 导出全部数据为 JSON 文件 */
export function exportData() {
  const data = loadTransactions()
  if (data.length === 0) return
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `snapbook_${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
}
