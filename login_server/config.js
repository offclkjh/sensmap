module.exports = {
  database: {
    user: process.env.DB_USER || 'yeramlee',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'sensmap_db',
    password: process.env.DB_PASSWORD || '',
    port: process.env.DB_PORT || 5432,
  },
  jwt: {
    secret: process.env.JWT_SECRET || 'your_jwt_secret_key_here_change_this_in_production'
  }
};
