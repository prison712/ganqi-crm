import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ConfigProvider, App as AntApp } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { AuthProvider } from './auth/AuthContext.jsx';
import App from './App.jsx';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode><ConfigProvider locale={zhCN} theme={{ token: { colorPrimary: '#f58220', borderRadius: 8, colorBgLayout: '#f4f7fb', colorTextSecondary: '#5b6d7c' } }}><AntApp><BrowserRouter><AuthProvider><App /></AuthProvider></BrowserRouter></AntApp></ConfigProvider></React.StrictMode>
);
