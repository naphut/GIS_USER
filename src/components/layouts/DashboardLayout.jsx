import React, { useState } from 'react';
import Sidebar from '../common/Sidebar';
import MainDashboard from '../dashboard/MainDashboard';
import DashboardCA from '../dashboard/Signed_CA_Dashbaord/Dashboard_CA';
import DashboardRequest from '../dashboard/Request_i_E_dashboard/Dashboard_Reuest';
import DashboardStockout from '../dashboard/Stockout_yet_Dashboard/Dashboad_Stockout';
import ImportCA from '../../Page/Signed_CA/Import_CA';
import ExportCA from '../../Page/Signed_CA/Export_CA';
import STOCKOUT_YET_CONFIRM from '../../Page/Stockout_yet/STOCKOUT_YET_CONFIRM';
import NO_CREATE_HAND_OVER from '../../Page/Stockout_yet/NO_CREATE_HAND_OVER';
import STOCK_OUT_NOTE_CONFIRMED from '../../Page/Stockout_yet/stock_out_note_confirmed';
import { Restock_in as RestockIn } from '../../Page/Request_IN_E/Restock_in';
import { Restock_out as RestockOut } from '../../Page/Request_IN_E/Restock_out';

const DashboardLayout = ({ user, onLogout }) => {
  const [selectedMenuItem, setSelectedMenuItem] = useState('dashboard');

  // Render content based on selected menu item
  const renderContent = () => {
    switch (selectedMenuItem) {
      case 'dashboard':
        return <MainDashboard onNavigate={setSelectedMenuItem} user={user} />;
      
      // Dashboard group overview pages
      case 'stockout_group':
        return <DashboardStockout isEmbedded={true} onNavigate={setSelectedMenuItem} user={user} />;
      
      case 'signed_ca_group':
        return <DashboardCA user={user} />;
      
      case 'restock_group':
        return <DashboardRequest user={user} />;

      // CONFIRMED HAND OVER ON SYSTEM Group
      case 'STOCKOUT_YET_CONFIRM':
        return <STOCKOUT_YET_CONFIRM user={user} />;
      
      case 'NO_CREATE_HAND_OVER':
        return <NO_CREATE_HAND_OVER user={user} />;
      
      case 'STOCK_OUT_NOTE_CONFIRMED':
        return <STOCK_OUT_NOTE_CONFIRMED user={user} />;
      
      // SIGNED "CA" ON THE SYSTEM YET Group
      case 'STOCK_OUT_IS_SIGNING':
        return <ExportCA user={user} />;
      
      case 'STOCK_IN_IS_SIGNING':
        return <ImportCA user={user} />;
      
      // RESTOCK GROUP
      case 'RESTOCK_IN':
        return <RestockIn user={user} />;
      
      case 'RESTOCK_OUT':
        return <RestockOut user={user} />;
      
      default:
        return <MainDashboard onNavigate={setSelectedMenuItem} user={user} />;
    }
  };

  return (
    <div className="flex h-screen bg-gray-100">
      {/* Sidebar */}
      <div className="flex-shrink-0">
        <Sidebar 
          onSelect={setSelectedMenuItem} 
          selected={selectedMenuItem} 
          user={user}
          onLogout={onLogout}
        />
      </div>

      {/* Main Content */}
      <div key={selectedMenuItem} className="flex-1 overflow-y-auto animate-fadeIn">
        {renderContent()}
      </div>
    </div>
  );
};

export default DashboardLayout;