import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { analyzeScreenshot } from './api'
import {
  StoredTransaction, TxType,
  loadTransactions, mergeResult,
  updateTransaction, deleteTransaction,
  addManual, exportData,
} from './store'
import './App.css'

/* ===== API 配置 ===== */

interface ApiConfig {
  apiKey: string; baseUrl: string; model: string; provider: string
}
const PROVIDERS: { name: string; baseUrl: string; model: string }[] = [
  { name: '智谱 GLM-4V（推荐）', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4v' },
  { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' },
  { name: 'OpenAI GPT-4o', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o' },
  { name: '自定义', baseUrl: '', model: '' },
]
function loadConfig(): ApiConfig {
  try { const s = localStorage.getItem('snapbook_config'); if (s) return JSON.parse(s) } catch {}
  return { apiKey: '', baseUrl: PROVIDERS[0].baseUrl, model: PROVIDERS[0].model, provider: '0' }
}

/* ===== 分类 ===== */

const EXPENSE_CATS = ['🍜 餐饮', '🚗 交通', '🛒 购物', '🏠 居家', '🎮 娱乐', '💊 医疗', '📚 教育', '💬 通讯', '🎁 人情', '📦 其他']
const INCOME_CATS = ['💰 工资', '🎁 红包', '💸 退款', '🔄 报销', '📈 理财', '📦 其他收入']

/* ===== 工具 ===== */

function getYearMonth(iso: string) { return iso.slice(0, 7) }
function formatYM(ym: string) { const [y, m] = ym.split('-'); return `${y}年${m}月` }
function genId() { return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}` }

/* ========================================
   主组件
   ======================================== */

export default function App() {
  // 配置
  const [config, setConfig] = useState<ApiConfig>(loadConfig)
  const [showSettings, setShowSettings] = useState(false)
  useEffect(() => { localStorage.setItem('snapbook_config', JSON.stringify(config)) }, [config])

  // 数据
  const [transactions, setTransactions] = useState<StoredTransaction[]>(loadTransactions)
  const refresh = useCallback(() => setTransactions(loadTransactions()), [])

  // 上传
  const [image, setImage] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadMsg, setUploadMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // 编辑
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<Partial<StoredTransaction>>({})

  // 手动记账弹窗
  const [showAdd, setShowAdd] = useState(false)
  const [addType, setAddType] = useState<TxType>('expense')
  const [addAmount, setAddAmount] = useState('')
  const [addCategory, setAddCategory] = useState(EXPENSE_CATS[0])
  const [addDate, setAddDate] = useState(new Date().toISOString().slice(0, 10))
  const [addNote, setAddNote] = useState('')

  // 月份
  const [selectedYM, setSelectedYM] = useState<string | null>(null)
  const monthOptions = useMemo(() => {
    const set = new Set(transactions.map(t => getYearMonth(t.createdAt)))
    return Array.from(set).sort().reverse()
  }, [transactions])

  const filteredTxs = useMemo(() => {
    if (!selectedYM) return transactions
    return transactions.filter(t => getYearMonth(t.createdAt) === selectedYM)
  }, [transactions, selectedYM])

  // 月度汇总
  const monthStats = useMemo(() => {
    let income = 0, expense = 0
    const expByCat: Record<string, number> = {}
    const incByCat: Record<string, number> = {}
    filteredTxs.forEach(t => {
      if (t.type === 'income') {
        income += t.amount
        incByCat[t.category] = (incByCat[t.category] || 0) + t.amount
      } else {
        expense += t.amount
        expByCat[t.category] = (expByCat[t.category] || 0) + t.amount
      }
    })
    return { income, expense, balance: income - expense, expByCat, incByCat }
  }, [filteredTxs])

  // ---- 上传截图 ----
  const handleFile = useCallback(async (file: File) => {
    setError(null); setUploadMsg(null); setUploading(true)
    try {
      const base64 = await new Promise<string>((resolve) => {
        if (file.size > 2 * 1024 * 1024) {
          const img = new Image()
          img.onload = () => {
            const c = document.createElement('canvas')
            const s = Math.min(1, 1200 / img.width)
            c.width = img.width * s; c.height = img.height * s
            c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
            resolve(c.toDataURL('image/jpeg', 0.85))
          }
          img.src = URL.createObjectURL(file)
        } else {
          const r = new FileReader()
          r.onload = () => resolve(r.result as string)
          r.readAsDataURL(file)
        }
      })
      setImage(base64)
      const data = await analyzeScreenshot(base64, {
        apiKey: config.apiKey, baseUrl: config.baseUrl, model: config.model,
      })
      const { added, skipped } = mergeResult(data)
      refresh()
      setImage(null)  // 上传成功后清掉截图预览
      if (added > 0) setUploadMsg(`✅ 新增 ${added} 条支出${skipped > 0 ? `，跳过 ${skipped} 条重复` : ''}`)
      else if (skipped > 0) setUploadMsg(`⏭ 全部 ${skipped} 条已存在`)
      else setUploadMsg('⚠️ 未识别到消费记录')
    } catch (err: any) { setError(err.message || '未知错误'); setImage(null) }
    finally { setUploading(false) }
  }, [config, refresh])

  // ---- 手动添加 ----
  const handleAdd = () => {
    const amount = parseFloat(addAmount)
    if (!amount || amount <= 0) return
    const cats = addType === 'income' ? INCOME_CATS : EXPENSE_CATS
    const cat = cats.includes(addCategory) ? addCategory : cats[0]
    addManual({
      merchant: addNote || (addType === 'income' ? '收入' : '支出'),
      amount,
      category: cat,
      date: addDate,
      type: addType,
      note: addType === 'income' ? undefined : (addNote || undefined),
    })
    refresh()
    // 重置
    setAddAmount('')
    setAddNote('')
    setAddDate(new Date().toISOString().slice(0, 10))
    setShowAdd(false)
  }

  // ---- 编辑 ----
  const startEdit = (t: StoredTransaction) => { setEditingId(t.id); setEditDraft({ ...t }) }
  const saveEdit = () => {
    if (!editingId) return
    updateTransaction(editingId, editDraft)
    setEditingId(null); refresh()
  }
  const handleDelete = (id: string) => {
    if (!confirm('确定删除？')) return
    deleteTransaction(id); refresh()
  }

  const hasConfig = config.apiKey.length > 10
  const sortedTxs = [...filteredTxs].sort((a, b) => b.createdAt.localeCompare(a.createdAt))

  return (
    <div className="app">
      {/* 顶栏 */}
      <header className="header">
        <h1>📸 截图记账</h1>
        <div className="header-btns">
          {transactions.length > 0 && <button type="button" className="icon-btn" title="导出数据" onClick={exportData}>📤</button>}
          <button type="button" className="icon-btn" title="设置" onClick={() => setShowSettings(!showSettings)}>⚙️</button>
        </div>
      </header>

      {showSettings && <SettingsPanel config={config} setConfig={setConfig} onClose={() => setShowSettings(false)} />}

      {/* 上传区域 */}
      <div className={`upload-zone compact ${image ? 'has-image' : ''} ${uploading ? 'disabled' : ''}`}
        onClick={() => !uploading && fileRef.current?.click()}>
        {image
          ? <img src={image} alt="截图" className="preview-img small" />
          : <div className="upload-placeholder compact"><span className="upload-icon-sm">📷</span><span>点击上传消费截图</span></div>}
        {uploading && <div className="upload-overlay"><div className="spinner" /><span>识别中…</span></div>}
        <input ref={fileRef} type="file" accept="image/*" className="hidden-input" title="选择截图"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (!f) return
            if (!hasConfig) { setShowSettings(true); setError('请先配置 AI Key'); return }
            handleFile(f)
          }} />
      </div>

      {uploadMsg && <div className="toast">{uploadMsg}</div>}
      {error && <div className="error-box"><p>❌ {error}</p></div>}

      {/* 空态 */}
      {transactions.length === 0 && !uploading && (
        <div className="empty-state">
          <div className="empty-icon">🧾</div>
          <p>还没有记录</p>
          <p className="empty-hint">截一张账单图上传，或点右下角 + 手动记账</p>
        </div>
      )}

      {transactions.length > 0 && (
        <>
          {/* 月份选择 */}
          <div className="month-bar">
            <select title="选择月份" value={selectedYM || ''} onChange={(e) => setSelectedYM(e.target.value || null)}>
              <option value="">📅 全部 ({transactions.length} 条)</option>
              {monthOptions.map(ym => {
                const n = transactions.filter(t => getYearMonth(t.createdAt) === ym).length
                return <option key={ym} value={ym}>{formatYM(ym)} · {n} 条</option>
              })}
            </select>
          </div>

          {/* 汇总卡片：收入 / 支出 / 结余 */}
          <div className="stats-row">
            <div className="stat-card income">
              <div className="stat-label">🟢 收入</div>
              <div className="stat-num">+{monthStats.income.toFixed(2)}</div>
            </div>
            <div className="stat-card expense">
              <div className="stat-label">🔴 支出</div>
              <div className="stat-num">-{monthStats.expense.toFixed(2)}</div>
            </div>
          </div>
          <div className={`balance-card ${monthStats.balance >= 0 ? 'positive' : 'negative'}`}>
            <span>💡 {selectedYM ? formatYM(selectedYM) : '累计'} 结余</span>
            <span className="balance-num">
              {monthStats.balance >= 0 ? '+' : ''}{monthStats.balance.toFixed(2)}
            </span>
          </div>

          {/* 支出分类 */}
          {Object.keys(monthStats.expByCat).length > 0 && (
            <div className="card">
              <h3>📊 支出分类</h3>
              <div className="category-list">
                {Object.entries(monthStats.expByCat).sort(([,a],[,b]) => b - a).map(([cat, amt]) => (
                  <div key={cat} className="category-row">
                    <span>{cat}</span>
                    <div className="cat-bar-wrap"><div className="cat-bar" style={{ width: `${(amt / monthStats.expense) * 100}%` }} /></div>
                    <span className="cat-amount">¥{amt.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 收入分类 */}
          {Object.keys(monthStats.incByCat).length > 0 && (
            <div className="card">
              <h3>💚 收入分类</h3>
              <div className="category-list">
                {Object.entries(monthStats.incByCat).sort(([,a],[,b]) => b - a).map(([cat, amt]) => (
                  <div key={cat} className="category-row">
                    <span>{cat}</span>
                    <div className="cat-bar-wrap"><div className="cat-bar inc" style={{ width: `${(amt / monthStats.income) * 100}%` }} /></div>
                    <span className="cat-amount inc">¥{amt.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 明细 */}
          <div className="card">
            <h3>📋 明细 ({filteredTxs.length} 笔)</h3>
            {filteredTxs.length === 0 ? <p className="no-data">无记录</p> :
              sortedTxs.map(t => (
                <div key={t.id} className="txn-row">
                  {editingId === t.id ? (
                    <div className="edit-form">
                      <input className="edit-input full" value={editDraft.merchant || ''} placeholder="商户/备注" title="商户"
                        onChange={(e) => setEditDraft({ ...editDraft, merchant: e.target.value })} />
                      <div className="edit-row">
                        <input className="edit-input num" type="number" value={editDraft.amount || ''} placeholder="金额" title="金额"
                          step="0.01" onChange={(e) => setEditDraft({ ...editDraft, amount: parseFloat(e.target.value) || 0 })} />
                        <select className="edit-select" title="类型" value={editDraft.type || 'expense'}
                          onChange={(e) => { const tp = e.target.value as TxType; setEditDraft({ ...editDraft, type: tp, category: tp === 'income' ? INCOME_CATS[0] : EXPENSE_CATS[0] }) }}>
                          <option value="expense">🔴 支出</option><option value="income">🟢 收入</option>
                        </select>
                      </div>
                      <div className="edit-row">
                        <select className="edit-select" title="分类" value={editDraft.category || ''}
                          onChange={(e) => setEditDraft({ ...editDraft, category: e.target.value })}>
                          {(editDraft.type === 'income' ? INCOME_CATS : EXPENSE_CATS).map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                        <input className="edit-input" value={editDraft.date || ''} placeholder="日期" title="日期"
                          onChange={(e) => setEditDraft({ ...editDraft, date: e.target.value })} />
                      </div>
                      <div className="edit-actions">
                        <button type="button" className="btn-sm btn-save" onClick={saveEdit}>✅ 保存</button>
                        <button type="button" className="btn-sm btn-cancel" onClick={() => setEditingId(null)}>取消</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="txn-left" onClick={() => startEdit(t)} title="点击编辑">
                        <div className="txn-merchant">
                          {t.type === 'income' && <span className="tag-inc">收</span>}
                          {t.merchant || (t.type === 'income' ? '收入' : '未知商户')}
                        </div>
                        {t.date && <div className="txn-date">{t.date}</div>}
                        {t.note && <div className="txn-note">{t.note}</div>}
                      </div>
                      <div className="txn-right">
                        <div className={`txn-amount ${t.type === 'income' ? 'is-income' : ''}`}>
                          {t.type === 'income' ? '+' : '-'}¥{t.amount.toFixed(2)}
                        </div>
                        <div className="txn-category">{t.category}</div>
                        <button type="button" className="btn-del" title="删除"
                          onClick={(e) => { e.stopPropagation(); handleDelete(t.id) }}>🗑</button>
                      </div>
                    </>
                  )}
                </div>
              ))}
          </div>

          {/* 底部 */}
          <div className="bottom-actions">
            <button type="button" className="btn-outline" onClick={() => { setImage(null); fileRef.current?.click() }}>📷 再传一张</button>
            <button type="button" className="btn-outline" onClick={exportData}>📤 导出</button>
          </div>
        </>
      )}

      {/* ---- 浮动 + 按钮 ---- */}
      <button type="button" className="fab" title="手动记账" onClick={() => {
        setAddDate(new Date().toISOString().slice(0, 10))
        setShowAdd(true)
      }}>+</button>

      {/* ---- 手动记账弹窗 ---- */}
      {showAdd && (
        <div className="modal-overlay" onClick={() => setShowAdd(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>✍️ 手动记账</h3>

            {/* 类型切换 */}
            <div className="type-toggle">
              <button type="button" className={`toggle-btn ${addType === 'expense' ? 'active exp' : ''}`}
                onClick={() => { setAddType('expense'); setAddCategory(EXPENSE_CATS[0]) }}>🔴 支出</button>
              <button type="button" className={`toggle-btn ${addType === 'income' ? 'active inc' : ''}`}
                onClick={() => { setAddType('income'); setAddCategory(INCOME_CATS[0]) }}>🟢 收入</button>
            </div>

            {/* 金额 */}
            <label>金额</label>
            <input className="input-lg" type="number" placeholder="0.00" step="0.01" inputMode="decimal"
              value={addAmount} onChange={(e) => setAddAmount(e.target.value)} autoFocus />

            {/* 分类 */}
            <label>分类</label>
            <div className="cat-grid">
              {(addType === 'income' ? INCOME_CATS : EXPENSE_CATS).map(c => (
                <button key={c} type="button"
                  className={`cat-btn ${addCategory === c ? 'selected' : ''}`}
                  onClick={() => setAddCategory(c)}>{c}</button>
              ))}
            </div>

            {/* 日期 + 备注 */}
            <div className="add-row">
              <input className="input-sm" type="date" value={addDate} title="日期"
                onChange={(e) => setAddDate(e.target.value)} />
              <input className="input-sm flex-1" placeholder={addType === 'income' ? '备注（选填）' : '买了什么（选填）'} title="备注"
                value={addNote} onChange={(e) => setAddNote(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleAdd() }} />
            </div>

            {/* 按钮 */}
            <div className="modal-actions">
              <button type="button" className="btn-cancel-lg" onClick={() => setShowAdd(false)}>取消</button>
              <button type="button" className="btn-save-lg" onClick={handleAdd}
                disabled={!addAmount || parseFloat(addAmount) <= 0}>
                ✅ 记一笔
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ========================================
   设置面板
   ======================================== */

function SettingsPanel({ config, setConfig, onClose }: {
  config: ApiConfig; setConfig: (c: ApiConfig) => void; onClose: () => void
}) {
  return (
    <div className="settings-card">
      <h3>🔑 AI 配置（仅存本地）</h3>
      <label>服务商</label>
      <select title="AI服务商" value={config.provider} onChange={(e) => {
        const i = Number(e.target.value); const p = PROVIDERS[i]
        setConfig({ ...config, provider: e.target.value, baseUrl: p.baseUrl, model: p.model })
      }}>
        {PROVIDERS.map((p, i) => <option key={i} value={i}>{p.name}</option>)}
      </select>
      <label>API Key</label>
      <input type="password" placeholder="粘贴 API Key" title="API密钥" value={config.apiKey}
        onChange={(e) => setConfig({ ...config, apiKey: e.target.value.trim() })} />
      {config.provider === '3' && <>
        <label>Base URL</label><input placeholder="https://open.bigmodel.cn/api/paas/v4" title="接口地址" value={config.baseUrl} onChange={(e) => setConfig({ ...config, baseUrl: e.target.value.trim() })} />
        <label>模型</label><input placeholder="glm-4v" title="模型名" value={config.model} onChange={(e) => setConfig({ ...config, model: e.target.value.trim() })} />
      </>}
      <div className="settings-hint">💡 智谱AI（open.bigmodel.cn）注册送额度，国内快</div>
      <button type="button" className="btn-primary" onClick={onClose}>✅ 完成</button>
    </div>
  )
}
