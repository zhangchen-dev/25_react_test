// FastHtml.jsx（React前端组件）
import React from 'react';

const FastHtml = () => {
  // 前端触发录制的逻辑：调用后端接口（需先启动Express服务）
  const startRecord = async () => {
    try {
      // 调用后端接口触发录制（后续可扩展Express服务）
      const response = await fetch('http://localhost:3001/start-record', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetUrl: 'https://xft-demo.cmburl.cn/psn/#/atnapp/schedule-manage/schedule-table'
        })
      });
      const data = await response.json();
      alert(`录制已启动：${data.message}`);
    } catch (error) {
      console.error('前端触发录制失败：', error);
      // 简易方案：提示用户手动运行Node.js脚本
      alert('请在终端运行：node page-recorder.js 开始录制');
    }
  };

  return (
    <div style={{ padding: '20px' }}>
      <button 
        onClick={startRecord}
        style={{ padding: '10px 20px', fontSize: '16px' }}
      >
        开始录制页面
      </button>
    </div>
  );
};

export default FastHtml;