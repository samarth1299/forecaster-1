'use client';

import React, { useState } from 'react';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ScatterChart, Scatter } from 'recharts';

export default function SalesPipelinePredictor() {
  const [page, setPage] = useState('upload');
  const [allDeals, setAllDeals] = useState([]);
  const [analysis, setAnalysis] = useState(null);
  const [forecast, setForecast] = useState(null);
  const [statusFilter, setStatusFilter] = useState('CW');
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
      setTimeout(() => setPage('forecast'), 1000);
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
      analyzeDeals(deals, 'CW');
    } catch (e) {
      showMessage(`Parse error: ${e.message}`, 'error');
    }
  };

  const calculateCorrelation = (arr1, arr2) => {
    if (arr1.length < 2 || arr2.length < 2) return 0;
    
    const n = Math.min(arr1.length, arr2.length);
    const x = arr1.slice(0, n);
    const y = arr2.slice(0, n);
    
    const xMean = x.reduce((a, b) => a + b) / n;
    const yMean = y.reduce((a, b) => a + b) / n;
    
    let numerator = 0, denomX = 0, denomY = 0;
    for (let i = 0; i < n; i++) {
      const xDiff = x[i] - xMean;
      const yDiff = y[i] - yMean;
      numerator += xDiff * yDiff;
      denomX += xDiff * xDiff;
      denomY += yDiff * yDiff;
    }
    
    const denom = Math.sqrt(denomX * denomY);
    return denom === 0 ? 0 : Math.abs(numerator / denom);
  };

  const analyzeDeals = (deals, filter) => {
    const filtered = deals.filter(d => d['status'] === filter);

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

    const monthlyMap = {};
    closedDeals.forEach(d => {
      const key = d.month;
      if (!monthlyMap[key]) {
        monthlyMap[key] = { deals: 0, revenue: 0, month: key, daysToClose: [] };
      }
      monthlyMap[key].deals += 1;
      monthlyMap[key].revenue += d.revenue;
      monthlyMap[key].daysToClose.push(d.daysToClose);
    });

    const monthlyData = Object.values(monthlyMap).sort((a, b) => new Date(a.month) - new Date(b.month));

    const daysArray = closedDeals.map(d => d.daysToClose);
    const revenueArray = closedDeals.map(d => d.revenue);
    const dealsPerMonth = monthlyData.map(m => m.deals);
    const revenuePerMonth = monthlyData.map(m => m.revenue);

    const correlations = {
      daysVsRevenue: calculateCorrelation(daysArray, revenueArray),
      dealsVsRevenue: calculateCorrelation(dealsPerMonth, revenuePerMonth)
    };

    const avgDaysToClose = closedDeals.length > 0
      ? Math.round(closedDeals.reduce((sum, d) => sum + d.daysToClose, 0) / closedDeals.length)
      : 0;

    const avgDealValue = closedDeals.length > 0
      ? Math.round(closedDeals.reduce((sum, d) => sum + d.revenue, 0) / closedDeals.length)
      : 0;

    setAnalysis({
      monthlyData,
      closedDealsCount: closedDeals.length,
      avgDaysToClose,
      avgDealValue,
      correlations,
      totalRevenue: closedDeals.reduce((sum, d) => sum + d.revenue, 0),
      scatterData: closedDeals.map(d => ({ x: d.daysToClose, y: d.revenue }))
    });
  };

  const advancedForecast = () => {
    if (!analysis) return;

    const monthlyData = analysis.monthlyData;
    if (monthlyData.length === 0) {
      showMessage('No historical data to forecast', 'error');
      return;
    }

    const avgDeals = monthlyData.reduce((sum, m) => sum + m.deals, 0) / monthlyData.length;
    const avgRevenue = monthlyData.reduce((sum, m) => sum + m.revenue, 0) / monthlyData.length;
    
    let dealsTrend = 0, revenueTrend = 0;
    if (monthlyData.length >= 3) {
      const recent = monthlyData.slice(-3);
      const older = monthlyData.slice(-6, -3) || monthlyData.slice(0, 3);
      
      if (older.length > 0) {
        const recentAvgDeals = recent.reduce((sum, m) => sum + m.deals, 0) / recent.length;
        const olderAvgDeals = older.reduce((sum, m) => sum + m.deals, 0) / older.length;
        dealsTrend = (recentAvgDeals - olderAvgDeals) / 3;
        
        const recentAvgRev = recent.reduce((sum, m) => sum + m.revenue, 0) / recent.length;
        const olderAvgRev = older.reduce((sum, m) => sum + m.revenue, 0) / older.length;
        revenueTrend = (recentAvgRev - olderAvgRev) / 3;
      }
    }

    const correlation = analysis.correlations.dealsVsRevenue;
    const correlationWeight = Math.min(correlation, 1);

    const forecastData = [];
    const currentDate = new Date();

    for (let i = 1; i <= forecastMonths; i++) {
      const futureDate = new Date(currentDate);
      futureDate.setMonth(futureDate.getMonth() + i);
      const monthLabel = futureDate.toLocaleString('default', { month: 'short', year: 'numeric' });

      let forecastedDeals = Math.max(1, Math.round(avgDeals + dealsTrend * i * 0.7));
      let forecastedRevenue = Math.max(0, Math.round(avgRevenue + revenueTrend * i * 0.7));

      if (correlationWeight > 0.3) {
        forecastedRevenue = Math.round(forecastedRevenue * (0.8 + correlationWeight * 0.2));
      }

      forecastData.push({
        month: monthLabel,
        deals: forecastedDeals,
        revenue: forecastedRevenue,
        avgDealValue: Math.round(forecastedRevenue / forecastedDeals),
        confidence: Math.round((0.6 + correlationWeight * 0.4) * 100)
      });
    }

    setForecast(forecastData);
  };

  if (page === 'upload') {
    return (
      <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', padding: '40px 20px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ maxWidth: '500px', width: '100%' }}>
          <div style={{ background: 'white', borderRadius: '16px', padding: '40px', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
            <div style={{ textAlign: 'center', marginBottom: '40px' }}>
              <div style={{ fontSize: '48px', marginBottom: '16px' }}>📊</div>
              <h1 style={{ fontSize: '28px', fontWeight: '700', margin: '0 0 8px 0', color: '#1f2937' }}>Sales Predictor</h1>
              <p style={{ fontSize: '14px', color: '#6b7280', margin: 0 }}>Advanced forecasting with correlation analysis</p>
            </div>

            {message.text && (
              <div style={{ padding: '12px', borderRadius: '8px', marginBottom: '20px', background: message.type === 'success' ? '#dcfce7' : '#fee2e2', color: message.type === 'success' ? '#166534' : '#991b1b', fontSize: '13px', borderLeft: `4px solid ${message.type === 'success' ? '#22c55e' : '#ef4444'}` }}>
                {message.text}
              </div>
            )}

            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '8px', color: '#374151', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Google Sheets Link</label>
              <input type="text" value={sheetUrl} onChange={(e) => setSheetUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/..." style={{ width: '100%', padding: '12px 16px', border: '2px solid #e5e7eb', borderRadius: '8px', fontSize: '14px', fontFamily: 'inherit' }} />
            </div>

            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', marginBottom: '8px', color: '#374151', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Forecast Period</label>
              <select value={forecastMonths} onChange={(e) => setForecastMonths(parseInt(e.target.value))} style={{ width: '100%', padding: '12px 16px', border: '2px solid #e5e7eb', borderRadius: '8px', fontSize: '14px', fontFamily: 'inherit' }}>
                <option value={3}>Next 3 months</option>
                <option value={6}>Next 6 months</option>
                <option value={12}>Next 12 months</option>
              </select>
            </div>

            <button onClick={fetchSheet} disabled={loading} style={{ width: '100%', padding: '14px', background: '#667eea', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '600', fontSize: '14px', opacity: loading ? 0.6 : 1 }}>
              {loading ? '⏳ Loading...' : '📥 Load & Analyze'}
            </button>

            <p style={{ fontSize: '12px', color: '#9ca3af', textAlign: 'center', marginTop: '16px', margin: '16px 0 0 0' }}>
              Make sure your sheet is public<br/>(Share → Anyone with link)
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f9fafb' }}>
      <div style={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', padding: '30px 20px', color: 'white' }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
          <button onClick={() => { setPage('upload'); setAllDeals([]); setAnalysis(null); setForecast(null); }} style={{ background: 'rgba(255,255,255,0.2)', color: 'white', border: 'none', padding: '8px 16px', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', marginBottom: '16px', fontWeight: '500' }}>
            ← Upload New Sheet
          </button>
          <h1 style={{ fontSize: '28px', fontWeight: '700', margin: '0 0 8px 0' }}>📊 Forecast Analysis</h1>
          <p style={{ color: 'rgba(255,255,255,0.8)', margin: 0, fontSize: '14px' }}>Advanced multi-factor predictions with correlation insights</p>
        </div>
      </div>

      <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '30px 20px' }}>
        <div style={{ background: 'white', padding: '20px', borderRadius: '12px', marginBottom: '30px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
          <div style={{ fontSize: '13px', fontWeight: '600', color: '#6b7280', marginBottom: '12px', textTransform: 'uppercase' }}>Deal Status Filter</div>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {['CW', 'CL', 'WS'].map(status => (
              <button key={status} onClick={() => { setStatusFilter(status); analyzeDeals(allDeals, status); setForecast(null); }} style={{ padding: '8px 16px', border: '2px solid #e5e7eb', background: statusFilter === status ? '#667eea' : 'white', color: statusFilter === status ? 'white' : '#374151', borderRadius: '6px', cursor: 'pointer', fontWeight: '500', fontSize: '13px' }}>
                {status === 'CW' ? '✅ Closed Won' : status === 'CL' ? '❌ Closed Lost' : '🔇 Went Silent'}
              </button>
            ))}
          </div>
        </div>

        {analysis && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px', marginBottom: '30px' }}>
              <div style={{ background: 'white', padding: '20px', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
                <div style={{ fontSize: '12px', color: '#6b7280', fontWeight: '600', marginBottom: '8px', textTransform: 'uppercase' }}>Total Deals ({statusFilter})</div>
                <div style={{ fontSize: '28px', fontWeight: '700', color: '#667eea' }}>{analysis.closedDealsCount}</div>
              </div>
              <div style={{ background: 'white', padding: '20px', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
                <div style={{ fontSize: '12px', color: '#6b7280', fontWeight: '600', marginBottom: '8px', textTransform: 'uppercase' }}>Total Revenue</div>
                <div style={{ fontSize: '28px', fontWeight: '700', color: '#10b981' }}>${(analysis.totalRevenue / 1000).toFixed(1)}K</div>
              </div>
              <div style={{ background: 'white', padding: '20px', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
                <div style={{ fontSize: '12px', color: '#6b7280', fontWeight: '600', marginBottom: '8px', textTransform: 'uppercase' }}>Avg Deal Value</div>
                <div style={{ fontSize: '28px', fontWeight: '700', color: '#f59e0b' }}>${(analysis.avgDealValue / 1000).toFixed(1)}K</div>
              </div>
              <div style={{ background: 'white', padding: '20px', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
                <div style={{ fontSize: '12px', color: '#6b7280', fontWeight: '600', marginBottom: '8px', textTransform: 'uppercase' }}>Avg Days to Close</div>
                <div style={{ fontSize: '28px', fontWeight: '700', color: '#ef4444' }}>{analysis.avgDaysToClose}</div>
              </div>
            </div>

            <div style={{ background: 'white', padding: '24px', borderRadius: '12px', marginBottom: '30px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
              <h2 style={{ fontSize: '16px', fontWeight: '700', margin: '0 0 20px 0', color: '#1f2937' }}>📈 Correlation Analysis</h2>
              
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '20px' }}>
                <div>
                  <div style={{ fontSize: '13px', color: '#6b7280', fontWeight: '500', marginBottom: '8px' }}>Days to Close vs Revenue</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div style={{ flex: 1, background: '#e5e7eb', height: '8px', borderRadius: '4px', overflow: 'hidden' }}>
                      <div style={{ background: '#667eea', height: '100%', width: `${(analysis.correlations.daysVsRevenue * 100)}%` }}></div>
                    </div>
                    <div style={{ fontSize: '16px', fontWeight: '700', color: '#667eea', minWidth: '40px' }}>{(analysis.correlations.daysVsRevenue * 100).toFixed(0)}%</div>
                  </div>
                  <p style={{ fontSize: '11px', color: '#9ca3af', margin: '8px 0 0 0' }}>
                    {analysis.correlations.daysVsRevenue > 0.5 ? '🟢 Strong' : analysis.correlations.daysVsRevenue > 0.3 ? '🟡 Moderate' : '🔴 Weak'}
                  </p>
                </div>

                <div>
                  <div style={{ fontSize: '13px', color: '#6b7280', fontWeight: '500', marginBottom: '8px' }}>Deals Count vs Revenue</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div style={{ flex: 1, background: '#e5e7eb', height: '8px', borderRadius: '4px', overflow: 'hidden' }}>
                      <div style={{ background: '#10b981', height: '100%', width: `${(analysis.correlations.dealsVsRevenue * 100)}%` }}></div>
                    </div>
                    <div style={{ fontSize: '16px', fontWeight: '700', color: '#10b981', minWidth: '40px' }}>{(analysis.correlations.dealsVsRevenue * 100).toFixed(0)}%</div>
                  </div>
                  <p style={{ fontSize: '11px', color: '#9ca3af', margin: '8px 0 0 0' }}>
                    {analysis.correlations.dealsVsRevenue > 0.5 ? '🟢 Strong' : analysis.correlations.dealsVsRevenue > 0.3 ? '🟡 Moderate' : '🔴 Weak'}
                  </p>
                </div>
              </div>
            </div>

            <div style={{ background: 'white', padding: '24px', borderRadius: '12px', marginBottom: '30px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
              <h2 style={{ fontSize: '16px', fontWeight: '700', margin: '0 0 20px 0', color: '#1f2937' }}>📊 Days to Close vs Revenue</h2>
              <ResponsiveContainer width="100%" height={250}>
                <ScatterChart>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="x" name="Days to Close" stroke="#9ca3af" />
                  <YAxis dataKey="y" name="Revenue ($)" stroke="#9ca3af" />
                  <Tooltip cursor={{ strokeDasharray: '3 3' }} />
                  <Scatter name="Deals" data={analysis.scatterData} fill="#667eea" />
                </ScatterChart>
              </ResponsiveContainer>
            </div>

            <div style={{ background: 'white', padding: '24px', borderRadius: '12px', marginBottom: '30px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
              <h2 style={{ fontSize: '16px', fontWeight: '700', margin: '0 0 16px 0', color: '#1f2937' }}>⚡ Generate Forecast</h2>
              <button onClick={advancedForecast} style={{ width: '100%', padding: '12px', background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '600', fontSize: '14px' }}>
                Generate {forecastMonths}-Month Forecast
              </button>
            </div>

            {forecast && (
              <>
                <div style={{ background: 'white', padding: '24px', borderRadius: '12px', marginBottom: '30px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}>
                  <h2 style={{ fontSize: '16px', fontWeight: '700', margin: '0 0 20px 0', color: '#1f2937' }}>💰 Revenue Forecast</h2>
                  <ResponsiveContainer width="100%" height={300}>
                    <LineChart data={forecast}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis dataKey="month" stroke="#9ca3af" />
                      <YAxis stroke="#9ca3af" />
                      <Tooltip formatter={(value) => `$${value.toLocaleString()}`} />
                      <Line type="monotone" dataKey="revenue" stroke="#10b981" strokeWidth={2} dot={{ fill: '#10b981', r: 4 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>

                <div style={{ background: 'white', padding: '24px', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.08)', overflowX: 'auto' }}>
                  <h2 style={{ fontSize: '16px', fontWeight: '700', margin: '0 0 16px 0', color: '#1f2937' }}>📋 Forecast Table</h2>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                    <thead>
                      <tr style={{ background: '#f9fafb', borderBottom: '2px solid #e5e7eb' }}>
                        <th style={{ padding: '12px', textAlign: 'left', fontWeight: '600', color: '#374151' }}>Month</th>
                        <th style={{ padding: '12px', textAlign: 'right', fontWeight: '600', color: '#374151' }}>Deals</th>
                        <th style={{ padding: '12px', textAlign: 'right', fontWeight: '600', color: '#374151' }}>Revenue</th>
                        <th style={{ padding: '12px', textAlign: 'right', fontWeight: '600', color: '#374151' }}>Avg Value</th>
                        <th style={{ padding: '12px', textAlign: 'right', fontWeight: '600', color: '#374151' }}>Confidence</th>
                      </tr>
                    </thead>
                    <tbody>
                      {forecast.map((f, i) => (
                        <tr key={i} style={{ borderBottom: '1px solid #e5e7eb' }}>
                          <td style={{ padding: '12px' }}>{f.month}</td>
                          <td style={{ padding: '12px', textAlign: 'right', fontWeight: '500' }}>{f.deals}</td>
                          <td style={{ padding: '12px', textAlign: 'right', fontWeight: '500', color: '#10b981' }}>${(f.revenue / 1000).toFixed(1)}K</td>
                          <td style={{ padding: '12px', textAlign: 'right' }}>${(f.avgDealValue / 1000).toFixed(1)}K</td>
                          <td style={{ padding: '12px', textAlign: 'right', fontWeight: '600', color: '#667eea' }}>{f.confidence}%</td>
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
    </div>
  );
}
