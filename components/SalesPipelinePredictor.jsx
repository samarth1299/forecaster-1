'use client';

import React, { useState } from 'react';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

export default function SalesPipelinePredictor() {
  const [allDeals, setAllDeals] = useState([]);
  const [analysis, setAnalysis] = useState(null);
  const [forecast, setForecast] = useState(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [forecastMonths, setForecastMonths] = useState(6);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [sheetUrl, setSheetUrl] = useState('');

  const showMessage = (msg, type = 'error') => {
    setMessage({ text: msg, type });
    setTimeout(() => setMessage(''), 4000);
  };

  const fetchSheet = async () => {
    if (!sheetUrl.trim()) {
      showMessage('Please enter a Google Sheets URL', 'error');
      return;
    }

    setLoading(true);
    try {
      const sheetId = sheetUrl.match(/\/d\/([a-zA-Z0-9-_]+)/)?.[1];
      if (!sheetId) throw new Error('Invalid URL format');

      const response = await fetch(`/api/sheets?sheetId=${sheetId}`);
      if (!response.ok) throw new Error('Failed to fetch sheet');

      const { data } = await response.json();
      parseData(data);
      showMessage('Sheet loaded successfully!', 'success');
    } catch (e) {
      showMessage(`Error: ${e.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  const parseData = (csv) => {
    try {
      const lines = csv.split('\n').filter(l => l.trim());
      const headers = lines[0].split(',').map(h => h.trim().toLowerCase());

      const deals = [];
      for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',').map(v => v.trim());
        if (values.length >= headers.length) {
          const deal = {};
          headers.forEach((h, idx) => {
            deal[h] = values[idx];
          });
          deals.push(deal);
        }
      }

      if (deals.length === 0) throw new Error('No valid deals found');
      setAllDeals(deals);
      analyzeDeals(deals);
    } catch (e) {
      showMessage(`Parse error: ${e.message}`, 'error');
    }
  };

  const analyzeDeals = (deals) => {
    const filtered = statusFilter === 'all' 
      ? deals 
      : deals.filter(d => d['status'] === statusFilter);

    const parsed = filtered.map(d => {
      const demoDate = new Date(d['date of demo'] || '');
      const paymentDate = new Date(d['date of payment'] || '');
      const daysToClose = parseInt(d['days to close']) || 
        (isNaN(demoDate) || isNaN(paymentDate) ? 0 : Math.floor((paymentDate - demoDate) / (1000 * 60 * 60 * 24)));

      return {
        demoDate,
        paymentDate,
        daysToClose: Math.max(0, daysToClose),
        source: d['source'] || 'Unknown',
        month: d['month'] || paymentDate.toLocaleString('default', { month: 'short', year: 'numeric' }),
        revenue: parseFloat(d['paid plan'] || 0) || 0
      };
    });

    const closedDeals = parsed.filter(d => d.paymentDate && !isNaN(d.paymentDate) && d.paymentDate.getFullYear() > 2000);
    const allDealsCount = parsed.filter(d => d.demoDate && !isNaN(d.demoDate) && d.demoDate.getFullYear() > 2000).length;

    const monthlyMap = {};
    closedDeals.forEach(d => {
      const key = d.month;
      if (!monthlyMap[key]) {
        monthlyMap[key] = { deals: 0, revenue: 0, month: key };
      }
      monthlyMap[key].deals += 1;
      monthlyMap[key].revenue += d.revenue;
    });

    const monthlyData = Object.values(monthlyMap).sort((a, b) => new Date(a.month) - new Date(b.month));

    const avgDaysToClose = closedDeals.length > 0
      ? Math.round(closedDeals.reduce((sum, d) => sum + d.daysToClose, 0) / closedDeals.length)
      : 0;

    const avgDealValue = closedDeals.length > 0
      ? Math.round(closedDeals.reduce((sum, d) => sum + d.revenue, 0) / closedDeals.length)
      : 0;

    const sourceMetrics = {};
    closedDeals.forEach(d => {
      if (!sourceMetrics[d.source]) {
        sourceMetrics[d.source] = { count: 0, revenue: 0, avgClose: [] };
      }
      sourceMetrics[d.source].count += 1;
      sourceMetrics[d.source].revenue += d.revenue;
      sourceMetrics[d.source].avgClose.push(d.daysToClose);
    });

    Object.keys(sourceMetrics).forEach(src => {
      sourceMetrics[src].avgClose = Math.round(
        sourceMetrics[src].avgClose.reduce((a, b) => a + b, 0) / sourceMetrics[src].avgClose.length
      );
    });

    setAnalysis({
      monthlyData,
      closedDealsCount: closedDeals.length,
      avgDaysToClose,
      avgDealValue,
      sourceMetrics,
      totalRevenue: closedDeals.reduce((sum, d) => sum + d.revenue, 0)
    });
  };

  const generateForecast = () => {
    if (!analysis) return;

    const monthlyData = analysis.monthlyData;
    if (monthlyData.length === 0) {
      showMessage('No historical data to forecast', 'error');
      return;
    }

    let avgMonthlyDeals = 0, avgMonthlyRevenue = 0;
    monthlyData.forEach(m => {
      avgMonthlyDeals += m.deals;
      avgMonthlyRevenue += m.revenue;
    });
    avgMonthlyDeals = Math.round(avgMonthlyDeals / monthlyData.length);
    avgMonthlyRevenue = Math.round(avgMonthlyRevenue / monthlyData.length);

    let dealsTrend = 0, revenueTrend = 0;
    if (monthlyData.length >= 2) {
      dealsTrend = (monthlyData[monthlyData.length - 1].deals - monthlyData[0].deals) / monthlyData.length;
      revenueTrend = (monthlyData[monthlyData.length - 1].revenue - monthlyData[0].revenue) / monthlyData.length;
    }

    const forecastData = [];
    const currentDate = new Date();

    for (let i = 1; i <= forecastMonths; i++) {
      const futureDate = new Date(currentDate);
      futureDate.setMonth(futureDate.getMonth() + i);
      const monthLabel = futureDate.toLocaleString('default', { month: 'short', year: 'numeric' });

      const forecastedDeals = Math.max(1, Math.round(avgMonthlyDeals + dealsTrend * i));
      const forecastedRevenue = Math.max(0, Math.round(avgMonthlyRevenue + revenueTrend * i));

      forecastData.push({
        month: monthLabel,
        deals: forecastedDeals,
        revenue: forecastedRevenue,
        avgDealValue: Math.round(forecastedRevenue / forecastedDeals),
        isForecast: true
      });
    }

    setForecast(forecastData);
  };

  const combinedData = analysis?.monthlyData ? [...analysis.monthlyData, ...(forecast || [])] : [];

  return (
    <div style={{ padding: '20px', maxWidth: '1200px', margin: '0 auto' }}>
      <header style={{ background: 'white', padding: '30px', borderRadius: '12px', marginBottom: '30px', boxShadow: '0 10px 30px rgba(0,0,0,0.1)' }}>
        <h1 style={{ fontSize: '32px', fontWeight: '700', margin: '0 0 10px 0' }}>📊 Sales Pipeline Predictor</h1>
        <p style={{ color: '#6b7280', margin: 0 }}>Forecast revenue and deals from your Google Sheet</p>
      </header>

      {message.text && (
        <div style={{
          padding: '16px',
          borderRadius: '8px',
          marginBottom: '20px',
          background: message.type === 'success' ? '#dcfce7' : '#fee2e2',
          color: message.type === 'success' ? '#166534' : '#991b1b',
          borderLeft: `4px solid ${message.type === 'success' ? '#22c55e' : '#ef4444'}`
        }}>
          {message.text}
        </div>
      )}

      <div style={{ background: 'white', padding: '30px', borderRadius: '12px', marginBottom: '30px', boxShadow: '0 10px 30px rgba(0,0,0,0.1)' }}>
        <h2 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '20px', marginTop: 0 }}>Load Your Google Sheet</h2>
        
        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'block', fontSize: '14px', fontWeight: '500', marginBottom: '8px', color: '#374151' }}>Google Sheets Link:</label>
          <input
            type="text"
            value={sheetUrl}
            onChange={(e) => setSheetUrl(e.target.value)}
            placeholder="https://docs.google.com/spreadsheets/d/YOUR_SHEET_ID/edit?usp=sharing"
            style={{ width: '100%', padding: '12px 16px', border: '2px solid #e5e7eb', borderRadius: '8px', fontSize: '14px', fontFamily: 'inherit' }}
          />
        </div>

        <button
          onClick={fetchSheet}
          disabled={loading}
          style={{
            padding: '12px 24px',
            background: '#667eea',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            cursor: 'pointer',
            fontWeight: '600',
            opacity: loading ? 0.6 : 1
          }}
        >
          {loading ? '⏳ Fetching...' : '📥 Fetch Sheet'}
        </button>
      </div>

      {analysis && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '20px', marginBottom: '30px' }}>
            <div style={{ background: 'white', padding: '20px', borderRadius: '12px', boxShadow: '0 4px 15px rgba(0,0,0,0.08)', textAlign: 'center' }}>
              <div style={{ fontSize: '13px', color: '#6b7280', fontWeight: '500', marginBottom: '10px', textTransform: 'uppercase' }}>Total Deals</div>
              <div style={{ fontSize: '32px', fontWeight: '700', color: '#667eea' }}>{analysis.closedDealsCount}</div>
            </div>
            <div style={{ background: 'white', padding: '20px', borderRadius: '12px', boxShadow: '0 4px 15px rgba(0,0,0,0.08)', textAlign: 'center' }}>
              <div style={{ fontSize: '13px', color: '#6b7280', fontWeight: '500', marginBottom: '10px', textTransform: 'uppercase' }}>Total Revenue</div>
              <div style={{ fontSize: '32px', fontWeight: '700', color: '#667eea' }}>${(analysis.totalRevenue / 1000).toFixed(1)}K</div>
            </div>
            <div style={{ background: 'white', padding: '20px', borderRadius: '12px', boxShadow: '0 4px 15px rgba(0,0,0,0.08)', textAlign: 'center' }}>
              <div style={{ fontSize: '13px', color: '#6b7280', fontWeight: '500', marginBottom: '10px', textTransform: 'uppercase' }}>Avg Deal Value</div>
              <div style={{ fontSize: '32px', fontWeight: '700', color: '#667eea' }}>${(analysis.avgDealValue / 1000).toFixed(1)}K</div>
            </div>
            <div style={{ background: 'white', padding: '20px', borderRadius: '12px', boxShadow: '0 4px 15px rgba(0,0,0,0.08)', textAlign: 'center' }}>
              <div style={{ fontSize: '13px', color: '#6b7280', fontWeight: '500', marginBottom: '10px', textTransform: 'uppercase' }}>Avg Days to Close</div>
              <div style={{ fontSize: '32px', fontWeight: '700', color: '#667eea' }}>{analysis.avgDaysToClose}</div>
            </div>
          </div>

          <div style={{ background: 'white', padding: '30px', borderRadius: '12px', marginBottom: '30px', boxShadow: '0 10px 30px rgba(0,0,0,0.1)' }}>
            <h2 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '20px', marginTop: 0 }}>Status Filter</h2>
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
              {['all', 'CW', 'CL', 'WS'].map(status => (
                <button
                  key={status}
                  onClick={() => {
                    setStatusFilter(status);
                    analyzeDeals(allDeals);
                  }}
                  style={{
                    padding: '10px 16px',
                    border: '2px solid #e5e7eb',
                    background: statusFilter === status ? '#667eea' : 'white',
                    color: statusFilter === status ? 'white' : '#374151',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    fontWeight: '600',
                    fontSize: '13px'
                  }}
                >
                  {status === 'all' ? 'All Deals' : status === 'CW' ? '✅ Closed Won' : status === 'CL' ? '❌ Closed Lost' : '🔇 Went Silent'}
                </button>
              ))}
            </div>
          </div>

          <div style={{ background: 'white', padding: '30px', borderRadius: '12px', marginBottom: '30px', boxShadow: '0 10px 30px rgba(0,0,0,0.1)' }}>
            <h2 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '20px', marginTop: 0 }}>Forecast Settings</h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '20px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '14px', fontWeight: '500', marginBottom: '8px', color: '#374151' }}>Forecast Period:</label>
                <select
                  value={forecastMonths}
                  onChange={(e) => setForecastMonths(parseInt(e.target.value))}
                  style={{ width: '100%', padding: '8px 12px', border: '2px solid #e5e7eb', borderRadius: '8px', fontFamily: 'inherit' }}
                >
                  <option value={3}>Next 3 months</option>
                  <option value={6}>Next 6 months</option>
                  <option value={12}>Next 12 months</option>
                </select>
              </div>
            </div>
            <button
              onClick={generateForecast}
              style={{ width: '100%', padding: '12px 24px', background: '#667eea', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '600' }}
            >
              ⚡ Generate Forecast
            </button>
          </div>

          {forecast && (
            <>
              <div style={{ background: 'white', padding: '30px', borderRadius: '12px', marginBottom: '30px', boxShadow: '0 10px 30px rgba(0,0,0,0.1)' }}>
                <h2 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '20px', marginTop: 0 }}>📈 Deal Count Forecast</h2>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={combinedData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="month" />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="deals" fill="#667eea" />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div style={{ background: 'white', padding: '30px', borderRadius: '12px', marginBottom: '30px', boxShadow: '0 10px 30px rgba(0,0,0,0.1)' }}>
                <h2 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '20px', marginTop: 0 }}>💰 Revenue Forecast</h2>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={combinedData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="month" />
                    <YAxis />
                    <Tooltip />
                    <Line type="monotone" dataKey="revenue" stroke="#10b981" />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              <div style={{ background: 'white', padding: '30px', borderRadius: '12px', boxShadow: '0 10px 30px rgba(0,0,0,0.1)', overflowX: 'auto' }}>
                <h2 style={{ fontSize: '18px', fontWeight: '600', marginBottom: '20px', marginTop: 0 }}>📋 Forecast Details</h2>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: '#f9fafb', borderBottom: '2px solid #e5e7eb' }}>
                      <th style={{ padding: '16px', textAlign: 'left', fontWeight: '600', fontSize: '13px', color: '#374151' }}>Month</th>
                      <th style={{ padding: '16px', textAlign: 'right', fontWeight: '600', fontSize: '13px', color: '#374151' }}>Deals</th>
                      <th style={{ padding: '16px', textAlign: 'right', fontWeight: '600', fontSize: '13px', color: '#374151' }}>Revenue</th>
                      <th style={{ padding: '16px', textAlign: 'right', fontWeight: '600', fontSize: '13px', color: '#374151' }}>Avg Deal Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {forecast.map((f, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid #e5e7eb' }}>
                        <td style={{ padding: '16px' }}>{f.month}</td>
                        <td style={{ padding: '16px', textAlign: 'right' }}>{f.deals}</td>
                        <td style={{ padding: '16px', textAlign: 'right' }}>${(f.revenue / 1000).toFixed(1)}K</td>
                        <td style={{ padding: '16px', textAlign: 'right' }}>${(f.avgDealValue / 1000).toFixed(1)}K</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
