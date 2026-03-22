import React from 'react';
import './HomePage.less'; // 导入LESS样式文件
import { useNavigate } from 'react-router-dom';
import { Button } from 'antd';

const HomePage: React.FC = () => {
  const navigator = useNavigate();
  // 获取当前日期
  const today = new Date();
  const dateString = today.toLocaleDateString('zh-CN', { 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric',
    weekday: 'long'
  });

  // 模拟登录用户信息
  const userInfo = {
    username: '张三',
    avatar: 'https://via.placeholder.com/40x40'
  };
  return (
    <div className="home-page">
      <header className="home-banner">
        <div className="home-banner-left">
          <h1>前端自建平台</h1>
          <p>{dateString}</p>
        </div>
        <div className="home-user">
          <img src={userInfo.avatar} alt="用户头像" />
          <span>欢迎，{userInfo.username}</span>
        </div>
      </header>

      <section className="module-grid">
        <article className="module-card module-primary">
          <div className="module-card-head">
            <span className="module-tag">模块一</span>
            <h2>静态页面克隆</h2>
            <p>基于现有流程进行页面资源抓取与静态化处理。</p>
          </div>
          <div className="module-card-footer">
            <Button type="primary" onClick={() => navigator('/fast-page')}>
              进入原录制模块
            </Button>
          </div>
        </article>

        <article className="module-card module-secondary">
          <div className="module-card-head">
            <span className="module-tag">模块二</span>
            <h2>演示指引录制</h2>
            <p>用于录入演示步骤、编辑主副标题、导出结构化指引数据。</p>
          </div>
          <div className="module-card-footer">
            <Button onClick={() => navigator('/record-step')}>进入第二模块</Button>
          </div>
        </article>

        <article className="module-card">
          <div className="module-card-head">
            <span className="module-tag">模块三</span>
            <h2>预留模块</h2>
            <p>预留给后续业务场景扩展。</p>
          </div>
          <div className="module-card-footer">
            <Button disabled>建设中</Button>
          </div>
        </article>

        <article className="module-card">
          <div className="module-card-head">
            <span className="module-tag">模块四</span>
            <h2>预留模块</h2>
            <p>预留给后续业务场景扩展。</p>
          </div>
          <div className="module-card-footer">
            <Button disabled>建设中</Button>
          </div>
        </article>
      </section>
    </div >
  );
};

export default HomePage;