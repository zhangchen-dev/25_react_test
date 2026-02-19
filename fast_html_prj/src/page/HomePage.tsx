import React from 'react';
import './HomePage.less'; // 导入LESS样式文件
import { useNavigate } from 'react-router-dom';

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
      {/* 第一个模块 - 快速页面构建 */}
      <section className="quick-build-module">
        {/* Banner 区域 */}
        <header className="banner">
          <div className="banner-content">
            <div className="date-info">
              <h2>{dateString}</h2>
            </div>
            <div className="login-info">
              <div className="user-avatar">
                <img src={userInfo.avatar} alt="用户头像" />
                <span className="username">欢迎，{userInfo.username}</span>
              </div>
            </div>
          </div>
        </header>
        
        <div className="module-content" onClick={()=>navigator('/fast-page')}>
          <h2>快速页面构建</h2>
          <p>这里是一些关于快速页面构建的描述内容...</p>
        </div>
      </section>

      {/* 使用grid容器包装下面的模块 */}
      <div className="modules-grid">
        {/* 第二个模块 */}
        <section className="module-two">
          <div className="module-content">
            <h2>模块二</h2>
            <p>这里是第二个模块的内容...</p>
          </div>
        </section>

        {/* 第三个模块 */}
        <section className="module-three">
          <div className="module-content">
            <h2>模块三</h2>
            <p>这里是第三个模块的内容...</p>
          </div>
        </section>

        {/* 第四个模块 */}
        <section className="module-four">
          <div className="module-content">
            <h2>模块四</h2>
            <p>这里是第四个模块的内容...</p>
          </div>
        </section>
      </div>
    </div>
  );
};

export default HomePage;