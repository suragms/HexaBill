// Use shared api instance (baseURL set for Render/Vercel). Do not use raw axios.
import api from './api'

export const reportsAPI = {
  getDashboardSummary: async () => {
    const response = await api.get('/reports/summary')
    return response.data
  },

  getProductSales: async (params) => {
    const response = await api.get('/reports/product-sales', { params })
    return response.data
  },

  getOutstandingPayments: async (params) => {
    const response = await api.get('/reports/outstanding', { params })
    return response.data
  },

  getLowStock: async () => {
    const response = await api.get('/products', { params: { lowStock: true, pageSize: 100 } })
    return response.data
  }
}