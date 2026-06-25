/**
 * 调用 AI Vision API 分析截图
 * 支持 OpenAI 兼容接口（智谱、DeepSeek、OpenAI 等）
 */

export interface Transaction {
  merchant: string
  amount: number
  category: string
  date: string
  note?: string
}

export interface AnalysisResult {
  transactions: Transaction[]
  summary: Record<string, number>
  totalExpense: number
  screenshotSource?: string
  remark?: string
}

const SYSTEM_PROMPT = `你是一个记账助手。用户会上传一张消费记录截图（可能是微信、支付宝、银行App的账单页面），请：

1. 识别截图中所有的消费/支出记录
2. 对每条记录自动归类到以下分类：
   - 🍜 餐饮 (吃饭、外卖、奶茶、零食等)
   - 🚗 交通 (打车、地铁、公交、加油、停车等)
   - 🛒 购物 (日用品、衣服、数码、网购等)
   - 🏠 居家 (房租、水电、物业、维修等)
   - 🎮 娱乐 (游戏、电影、KTV、旅游、运动等)
   - 💊 医疗 (看病、买药、体检等)
   - 📚 教育 (书籍、课程、培训等)
   - 💬 通讯 (话费、宽带等)
   - 🎁 人情 (红包、礼物、聚餐AA等)
   - 📦 其他 (无法归类的)

3. 汇总各类别的总金额

请严格按以下JSON格式返回（不要加markdown代码块标记）：

{
  "transactions": [
    {
      "merchant": "商户名称",
      "amount": 12.34,
      "category": "🍜 餐饮",
      "date": "2024-01-15",
      "note": "从截图中提取的补充信息"
    }
  ],
  "summary": {
    "🍜 餐饮": 100.00,
    "🚗 交通": 50.00
  },
  "totalExpense": 150.00,
  "screenshotSource": "微信支付/支付宝/银行App/其他",
  "remark": "对这张账单的整体备注"
}

注意：
- amount必须是数字类型
- 如果没有日期信息，date填空字符串
- 忽略截图中的收入/退款记录，只关注支出
- 如果无法识别消费记录，返回空transactions数组`

export async function analyzeScreenshot(
  imageBase64: string,
  config: { apiKey: string; baseUrl: string; model: string }
): Promise<AnalysisResult> {
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: {
                url: imageBase64.startsWith('data:')
                  ? imageBase64
                  : `data:image/png;base64,${imageBase64}`,
              },
            },
            {
              type: 'text',
              text: '请识别这张消费记录截图，提取所有支出并分类。',
            },
          ],
        },
      ],
      max_tokens: 2048,
      temperature: 0.1,
    }),
  })

  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error((err as any).error?.message || `API 返回 ${response.status}`)
  }

  const data = await response.json()
  const content: string = data.choices?.[0]?.message?.content || ''

  // 解析 JSON
  const cleanContent = content
    .replace(/```json\s*/g, '')
    .replace(/```\s*/g, '')
    .trim()

  return JSON.parse(cleanContent)
}
